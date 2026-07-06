import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { KycStatus, Prisma, UserRole } from "@prisma/client";
import * as bcrypt from "bcryptjs";

import { ApifyService } from "../common/apify.service";
import { PrismaService } from "../prisma/prisma.service";

const BADGE_THRESHOLDS_PAISE = [
  { tier: "platinum", minPaise: 10_000_000 },
  { tier: "gold", minPaise: 2_500_000 },
  { tier: "silver", minPaise: 500_000 },
] as const;

export function badgeTierFor(lifetimePaise: number): string {
  for (const { tier, minPaise } of BADGE_THRESHOLDS_PAISE) {
    if (lifetimePaise >= minPaise) return tier;
  }
  return "bronze";
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function computeStreakDays(liveSubmittedAts: Date[]): number {
  const dates = new Set(liveSubmittedAts.map(dateKey));
  if (dates.size === 0) return 0;

  const cursor = new Date();
  if (!dates.has(dateKey(cursor))) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  let streak = 0;
  while (dates.has(dateKey(cursor))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly apify: ApifyService,
  ) {}

  async getMe(userId: string, role: UserRole) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { brandProfile: true },
    });

    if (!user) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "User not found",
      });
    }

    const base = {
      id: user.id,
      role: user.role,
      email: user.email,
      phone: user.phone,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      username: user.username,
      kycStatus: user.kycStatus,
      kycDocumentUrl: user.kycDocumentUrl,
      kycRejectionReason: user.kycRejectionReason,
      companyName: user.brandProfile?.companyName ?? null,
      bio: user.bio,
      socialLinks: (user.socialLinks as Record<string, string> | null) ?? null,
      socialStats: (user.socialStats as Record<string, unknown> | null) ?? null,
    };

    if (role === UserRole.brand && user.brandProfile) {
      return {
        ...base,
        brandProfile: {
          id: user.brandProfile.id,
          companyName: user.brandProfile.companyName,
          logoUrl: user.brandProfile.logoUrl,
        },
      };
    }

    if (role === UserRole.creator) {
      const [wallet, liveDates] = await Promise.all([
        this.prisma.wallet.findUnique({ where: { userId }, select: { lifetimePaise: true } }),
        this.prisma.formatDeliverable.findMany({
          where: { participation: { creatorId: userId }, liveSubmittedAt: { not: null } },
          select: { liveSubmittedAt: true },
        }),
      ]);

      return {
        ...base,
        badgeTier: badgeTierFor(wallet?.lifetimePaise ?? 0),
        currentStreakDays: computeStreakDays(
          liveDates.map((d) => d.liveSubmittedAt!),
        ),
      };
    }

    return base;
  }

  async updateBrandProfile(
    userId: string,
    data: { companyName?: string; displayName?: string; logoUrl?: string },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { brandProfile: true },
    });
    if (!user?.brandProfile) {
      throw new BadRequestException({ code: "FORBIDDEN", message: "No brand profile found" });
    }

    const [updatedProfile, updatedUser] = await this.prisma.$transaction([
      this.prisma.brandProfile.update({
        where: { id: user.brandProfile.id },
        data: {
          ...(data.companyName !== undefined && { companyName: data.companyName }),
          ...(data.logoUrl !== undefined && { logoUrl: data.logoUrl }),
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          ...(data.displayName !== undefined && { displayName: data.displayName }),
        },
      }),
    ]);

    return {
      companyName: updatedProfile.companyName,
      logoUrl: updatedProfile.logoUrl,
      displayName: updatedUser.displayName,
    };
  }

  async updateProfile(
    userId: string,
    data: {
      displayName?: string;
      phone?: string;
      bio?: string;
      avatarUrl?: string;
      socialLinks?: Record<string, string>;
    },
  ) {
    try {
      const updated = await this.prisma.user.update({
        where: { id: userId },
        data: {
          ...(data.displayName !== undefined && { displayName: data.displayName }),
          ...(data.phone !== undefined && { phone: data.phone }),
          ...(data.bio !== undefined && { bio: data.bio }),
          ...(data.avatarUrl !== undefined && { avatarUrl: data.avatarUrl }),
          ...(data.socialLinks !== undefined && {
            socialLinks: data.socialLinks as Prisma.InputJsonValue,
          }),
        },
      });

      return {
        displayName: updated.displayName,
        phone: updated.phone,
        bio: updated.bio,
        avatarUrl: updated.avatarUrl,
        socialLinks: (updated.socialLinks as Record<string, string> | null) ?? null,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException({
          code: "CONFLICT",
          message: "Phone number already in use",
        });
      }
      throw error;
    }
  }

  async fetchAndStoreSocialStats(
    userId: string,
    platform: "instagram" | "youtube" | "twitter",
    handleOrUrl: string,
  ) {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { socialStats: true, socialLinks: true },
    });

    const currentLinks = (existing?.socialLinks as Record<string, string> | null) ?? {};

    // Save the handle immediately so it persists even if scraping fails
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        socialLinks: { ...currentLinks, [platform]: handleOrUrl } as Prisma.InputJsonValue,
      },
    });

    // Kick off Apify scraping in the background — don't block the response
    this._scrapeAndStoreStats(userId, platform, handleOrUrl).catch(() => {});

    return { platform, handle: handleOrUrl, status: "fetching" };
  }

  async disconnectSocial(userId: string, platform: string) {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { socialLinks: true, socialStats: true },
    });
    const links = { ...((existing?.socialLinks as Record<string, string> | null) ?? {}) };
    const stats = { ...((existing?.socialStats as Record<string, unknown> | null) ?? {}) };
    delete links[platform];
    delete stats[platform];
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        socialLinks: Object.keys(links).length ? (links as Prisma.InputJsonValue) : Prisma.DbNull,
        socialStats: Object.keys(stats).length ? (stats as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    });
    return { platform, status: "disconnected" };
  }

  private async _scrapeAndStoreStats(
    userId: string,
    platform: "instagram" | "youtube" | "twitter",
    handleOrUrl: string,
  ) {
    let stats = await this.apify.getSocialProfileStats(platform, handleOrUrl);

    // If Apify fails entirely, save a minimal fallback so the user isn't stuck
    // in "pending" state indefinitely — shows as connected with 0 stats.
    if (!stats) {
      const handle = handleOrUrl.trim().replace(/^@/, "").split("/").filter(Boolean).pop()?.split("?")[0] ?? handleOrUrl;
      stats = {
        platform,
        handle,
        displayName: null,
        followersCount: 0,
        followingCount: 0,
        postsCount: 0,
        profilePicUrl: null,
        bio: null,
        fetchedAt: new Date().toISOString(),
      };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { socialStats: true },
    });
    const currentStats = (user?.socialStats as Record<string, unknown> | null) ?? {};

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        socialStats: { ...currentStats, [platform]: stats } as Prisma.InputJsonValue,
      },
    });
  }

  async submitKyc(userId: string, documentUrl: string, documentType: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "User not found" });
    }
    if (user.kycStatus === KycStatus.verified) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "KYC is already verified",
      });
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        kycDocumentUrl: documentUrl,
        kycDocumentType: documentType,
        kycStatus: KycStatus.pending,
        kycSubmittedAt: new Date(),
        kycRejectionReason: null,
      },
    });

    return {
      kycStatus: updated.kycStatus,
      kycDocumentUrl: updated.kycDocumentUrl,
      kycSubmittedAt: updated.kycSubmittedAt?.toISOString() ?? null,
    };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Password login is not enabled for this account",
      });
    }

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Current password is incorrect",
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return { changed: true };
  }
}
