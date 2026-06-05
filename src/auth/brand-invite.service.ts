import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  BrandInviteStatus,
  BrandMembershipRole,
  User,
  UserRole,
} from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

import { parseDurationMs } from "../common/parse-duration";
import type { Env } from "../config/env";
import { EmailService } from "../notifications/email.service";
import { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "./auth.service";
import { hashRefreshToken } from "./otp.service";
import type { BrandInviteAcceptDto } from "./dto/brand-invite.dto";

@Injectable()
export class BrandInviteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly email: EmailService,
    private readonly auth: AuthService,
  ) {}

  async preview(token: string) {
    const invite = await this.findValidInviteByToken(token);
    if (!invite) {
      return {
        valid: false,
        expired: true,
        agencyName: null,
        brandName: null,
        email: null,
      };
    }

    const expired = invite.expiresAt < new Date();
    return {
      valid: !expired && invite.status === BrandInviteStatus.pending,
      expired,
      agencyName: invite.agency.companyName,
      brandName: invite.brandProfile.companyName,
      email: invite.email,
    };
  }

  async accept(dto: BrandInviteAcceptDto) {
    const invite = await this.findValidInviteByToken(dto.token);
    if (!invite) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Invalid or expired invite link",
      });
    }

    if (invite.expiresAt < new Date()) {
      await this.prisma.brandInvite.update({
        where: { id: invite.id },
        data: { status: BrandInviteStatus.expired },
      });
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Invite has expired",
      });
    }

    if (invite.status !== BrandInviteStatus.pending) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Invite is no longer valid",
      });
    }

    const email = invite.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    let ownerUserId: string;

    if (existing) {
      if (existing.role === UserRole.creator) {
        throw new ConflictException({
          code: "WRONG_PORTAL",
          message:
            "This email is registered as a creator. Use a different email for the brand account.",
        });
      }
      if (existing.role === UserRole.agency) {
        throw new ConflictException({
          code: "WRONG_PORTAL",
          message: "This email is registered as an agency account.",
        });
      }
      if (existing.role !== UserRole.brand) {
        throw new ConflictException({
          code: "CONFLICT",
          message: "Email cannot be used for this invite",
        });
      }

      await this.linkExistingBrandUser(existing, invite.brandProfileId);
      ownerUserId = existing.id;
    } else {
      if (!dto.password || dto.password.length < 8) {
        throw new BadRequestException({
          code: "VALIDATION_ERROR",
          message: "Password is required to create your brand account",
        });
      }
      const created = await this.createBrandOwnerFromInvite(
        email,
        dto.password,
        dto.displayName,
        invite.brandProfileId,
      );
      ownerUserId = created.id;
    }

    await this.prisma.brandInvite.update({
      where: { id: invite.id },
      data: {
        status: BrandInviteStatus.accepted,
        acceptedAt: new Date(),
      },
    });

    const session = await this.auth.createSessionForUser(ownerUserId);

    return {
      accepted: true,
      brandProfileId: invite.brandProfileId,
      ...session,
    };
  }

  async createAndSendInvite(
    agencyId: string,
    brandProfileId: string,
    invitedByUserId: string,
    email: string,
  ): Promise<{ sent: boolean; inviteId: string }> {
    const normalizedEmail = email.toLowerCase().trim();

    const pending = await this.prisma.brandInvite.findFirst({
      where: {
        brandProfileId,
        status: BrandInviteStatus.pending,
        expiresAt: { gt: new Date() },
      },
    });
    if (pending) {
      throw new ConflictException({
        code: "CONFLICT",
        message: "A pending invite already exists for this brand workspace",
      });
    }

    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = hashRefreshToken(rawToken);
    const ttlMs = parseDurationMs(
      this.config.get("BRAND_INVITE_TTL", { infer: true }),
    );

    const invite = await this.prisma.brandInvite.create({
      data: {
        brandProfileId,
        agencyId,
        email: normalizedEmail,
        tokenHash,
        invitedByUserId,
        expiresAt: new Date(Date.now() + ttlMs),
      },
    });

    await this.email.sendBrandInvite(normalizedEmail, rawToken);
    return { sent: true, inviteId: invite.id };
  }

  private async findValidInviteByToken(token: string) {
    const tokenHash = hashRefreshToken(token);
    return this.prisma.brandInvite.findUnique({
      where: { tokenHash },
      include: {
        agency: true,
        brandProfile: true,
      },
    });
  }

  private async linkExistingBrandUser(user: User, brandProfileId: string) {
    const profile = await this.prisma.brandProfile.findUnique({
      where: { id: brandProfileId },
    });
    if (!profile) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Brand workspace not found",
      });
    }

    const otherOwner = await this.prisma.brandMembership.findFirst({
      where: {
        brandProfileId,
        role: BrandMembershipRole.owner,
        userId: { not: user.id },
      },
    });
    if (otherOwner) {
      throw new ConflictException({
        code: "CONFLICT",
        message: "This brand workspace already has a different owner",
      });
    }

    const existingMembership = await this.prisma.brandMembership.findUnique({
      where: {
        brandProfileId_userId: { brandProfileId, userId: user.id },
      },
    });
    if (!existingMembership) {
      await this.prisma.brandMembership.create({
        data: {
          brandProfileId,
          userId: user.id,
          role: BrandMembershipRole.owner,
        },
      });
    }

    // Agency workspaces use membership only. brand_profiles.user_id is unique and
    // reserved for the brand user's own primary workspace (self-signup).
    const primaryProfile = await this.prisma.brandProfile.findUnique({
      where: { userId: user.id },
    });
    if (!primaryProfile && !profile.userId) {
      await this.prisma.brandProfile.update({
        where: { id: brandProfileId },
        data: { userId: user.id },
      });
    } else if (profile.userId && profile.userId !== user.id) {
      throw new ConflictException({
        code: "CONFLICT",
        message: "This brand workspace already has a different owner",
      });
    }

    await this.ensureBrandWallet(user.id);
  }

  private async createBrandOwnerFromInvite(
    email: string,
    password: string,
    displayName: string | undefined,
    brandProfileId: string,
  ): Promise<User> {
    const profile = await this.prisma.brandProfile.findUnique({
      where: { id: brandProfileId },
    });
    if (!profile) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Brand workspace not found",
      });
    }
    if (profile.userId) {
      throw new ConflictException({
        code: "CONFLICT",
        message: "This brand workspace already has an owner",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await this.prisma.user.create({
      data: {
        role: UserRole.brand,
        email,
        passwordHash,
        displayName: displayName?.trim() || profile.companyName,
        termsAcceptedAt: new Date(),
      },
    });

    await this.prisma.$transaction([
      this.prisma.brandProfile.update({
        where: { id: brandProfileId },
        data: { userId: user.id },
      }),
      this.prisma.brandMembership.create({
        data: {
          brandProfileId,
          userId: user.id,
          role: BrandMembershipRole.owner,
        },
      }),
    ]);

    await this.ensureBrandWallet(user.id);
    return user;
  }

  private async ensureBrandWallet(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      await this.prisma.wallet.create({ data: { userId } });
    }
  }
}
