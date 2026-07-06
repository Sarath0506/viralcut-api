import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";
import type { CreateCreatorProfileDto } from "./dto/creator-profile.dto";

@Injectable()
export class CreatorProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  private format(profile: {
    id: string;
    platform: string;
    handle: string;
    label: string | null;
    avatarUrl: string | null;
    isDefault: boolean;
  }) {
    return {
      id: profile.id,
      platform: profile.platform,
      handle: profile.handle,
      label: profile.label,
      avatarUrl: profile.avatarUrl,
      isDefault: profile.isDefault,
    };
  }

  async list(userId: string) {
    const profiles = await this.prisma.creatorProfile.findMany({
      where: { userId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
    return profiles.map((p) => this.format(p));
  }

  async create(userId: string, dto: CreateCreatorProfileDto) {
    const existing = await this.prisma.creatorProfile.findUnique({
      where: {
        userId_platform_handle: {
          userId,
          platform: dto.platform,
          handle: dto.handle,
        },
      },
    });
    if (existing) {
      throw new ConflictException({
        code: "CONFLICT",
        message: "This handle is already linked to your account",
      });
    }

    const count = await this.prisma.creatorProfile.count({ where: { userId } });
    const profile = await this.prisma.creatorProfile.create({
      data: {
        userId,
        platform: dto.platform,
        handle: dto.handle,
        label: dto.label,
        isDefault: count === 0,
      },
    });
    return this.format(profile);
  }

  async setDefault(userId: string, profileId: string) {
    const profile = await this.prisma.creatorProfile.findFirst({
      where: { id: profileId, userId },
    });
    if (!profile) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Profile not found",
      });
    }

    await this.prisma.$transaction([
      this.prisma.creatorProfile.updateMany({
        where: { userId },
        data: { isDefault: false },
      }),
      this.prisma.creatorProfile.update({
        where: { id: profileId },
        data: { isDefault: true },
      }),
    ]);

    return { ok: true };
  }

  async delete(userId: string, profileId: string) {
    const profile = await this.prisma.creatorProfile.findFirst({
      where: { id: profileId, userId },
      include: { _count: { select: { participations: true } } },
    });
    if (!profile) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Profile not found",
      });
    }
    if (profile._count.participations > 0) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "This profile has campaign history and can't be removed",
      });
    }

    await this.prisma.creatorProfile.delete({ where: { id: profileId } });

    if (profile.isDefault) {
      const next = await this.prisma.creatorProfile.findFirst({
        where: { userId },
        orderBy: { createdAt: "asc" },
      });
      if (next) {
        await this.prisma.creatorProfile.update({
          where: { id: next.id },
          data: { isDefault: true },
        });
      }
    }

    return { ok: true };
  }

  /** Ensures the profile belongs to the user, throwing NOT_FOUND otherwise. */
  async assertOwnership(userId: string, profileId: string) {
    const profile = await this.prisma.creatorProfile.findFirst({
      where: { id: profileId, userId },
    });
    if (!profile) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Creator profile not found",
      });
    }
    return profile;
  }
}
