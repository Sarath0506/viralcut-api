import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { CampaignStatus, Prisma, UserRole } from "@prisma/client";

import { BrandAccessService } from "../access/brand-access.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  DEFAULT_CAMPAIGN_PLATFORM,
  normalizeCampaignPlatforms,
} from "./campaign-platforms";
import type { CreateCampaignDto, UpdateCampaignDto } from "./dto/campaign.dto";
import type { ListCampaignsQueryDto } from "./dto/list-campaigns-query.dto";

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brandAccess: BrandAccessService,
  ) {}

  private async resolveScopeBrandIds(
    userId: string,
    role: UserRole,
    filterBrandProfileId?: string,
  ): Promise<string[]> {
    const accessible =
      await this.brandAccess.listAccessibleBrandProfileIds(userId, role);
    if (filterBrandProfileId) {
      await this.brandAccess.assertCanAccessBrand(
        userId,
        role,
        filterBrandProfileId,
      );
      return [filterBrandProfileId];
    }
    return accessible;
  }

  async listLiveForCreators() {
    const campaigns = await this.prisma.campaign.findMany({
      where: { status: CampaignStatus.live },
      orderBy: { createdAt: "desc" },
    });
    return campaigns.map((c) => this.formatCampaign(c));
  }

  async getLiveForCreator(campaignId: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, status: CampaignStatus.live },
    });
    if (!campaign) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Campaign not found",
      });
    }
    return this.formatCampaign(campaign);
  }

  async listForBrand(
    userId: string,
    role: UserRole,
    query: ListCampaignsQueryDto,
  ) {
    const brandProfileIds = await this.resolveScopeBrandIds(
      userId,
      role,
      query.brandProfileId,
    );
    if (brandProfileIds.length === 0) {
      return { items: [], total: 0, page: query.page ?? 1, limit: query.limit ?? 6 };
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 6;
    const skip = (page - 1) * limit;

    const where = {
      brandProfileId: { in: brandProfileIds },
      ...(query.status ? { status: query.status } : {}),
    };

    const [total, campaigns] = await this.prisma.$transaction([
      this.prisma.campaign.count({ where }),
      this.prisma.campaign.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          _count: { select: { submissions: true } },
          brandProfile: { select: { id: true, companyName: true } },
        },
      }),
    ]);

    return {
      items: campaigns.map((c) => ({
        ...this.formatCampaign(c),
        brandProfileId: c.brandProfileId,
        brandCompanyName: c.brandProfile.companyName,
        submissionCount: c._count.submissions,
      })),
      total,
      page,
      limit,
    };
  }

  async getForBrand(
    userId: string,
    role: UserRole,
    campaignId: string,
  ) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        _count: { select: { submissions: true } },
        brandProfile: { select: { id: true, companyName: true } },
      },
    });
    if (!campaign) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Campaign not found",
      });
    }

    await this.brandAccess.assertCanAccessBrand(
      userId,
      role,
      campaign.brandProfileId,
    );

    return {
      ...this.formatCampaign(campaign),
      brandProfileId: campaign.brandProfileId,
      brandCompanyName: campaign.brandProfile.companyName,
      submissionCount: campaign._count.submissions,
    };
  }

  async create(userId: string, role: UserRole, dto: CreateCampaignDto) {
    const brandProfileId =
      await this.brandAccess.resolveBrandProfileIdForMutation(
        userId,
        role,
        dto.brandProfileId,
      );
    const status = dto.status ?? CampaignStatus.draft;
    const isLive = status === CampaignStatus.live;

    if (isLive) {
      this.assertPublishable(dto);
    }

    const platforms = normalizeCampaignPlatforms(dto.platforms, dto.platform);

    const brief = this.buildBrief(dto) || (isLive ? "" : "Draft campaign — complete before publishing.");
    if (isLive && !brief) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Campaign brief is required to publish",
      });
    }

    const campaign = await this.prisma.campaign.create({
      data: {
        brandProfileId,
        createdByUserId: userId,
        title: dto.title,
        category: dto.category,
        platform: platforms[0] ?? DEFAULT_CAMPAIGN_PLATFORM,
        platforms,
        status,
        brief,
        briefHook: dto.briefHook,
        doRules: dto.doRules,
        avoidRules: dto.avoidRules,
        sourceAssets: dto.sourceAssets as Prisma.InputJsonValue | undefined,
        referenceAssets: dto.referenceAssets as Prisma.InputJsonValue | undefined,
        coverImageUrl: dto.coverImageUrl,
        productUrl: dto.productUrl,
        ratePer1kPaise: dto.ratePer1kPaise ?? 5_000,
        maxPayoutPaise: dto.maxPayoutPaise ?? 5_000_000,
        budgetPaise: dto.budgetPaise ?? 10_000_000,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
      } as Prisma.CampaignUncheckedCreateInput,
    });
    return this.formatCampaign(campaign);
  }

  async update(
    userId: string,
    role: UserRole,
    campaignId: string,
    dto: UpdateCampaignDto,
  ) {
    const existing = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });
    if (!existing) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Campaign not found",
      });
    }

    await this.brandAccess.assertCanAccessBrand(
      userId,
      role,
      existing.brandProfileId,
    );

    const nextStatus = dto.status ?? existing.status;
    if (dto.status && dto.status !== existing.status) {
      this.assertStatusTransition(existing.status, dto.status);
    }
    if (nextStatus === CampaignStatus.live && existing.status !== CampaignStatus.live) {
      this.assertPublishable({
        title: dto.title ?? existing.title,
        briefHook: dto.briefHook ?? existing.briefHook ?? undefined,
        ratePer1kPaise: dto.ratePer1kPaise ?? existing.ratePer1kPaise,
        maxPayoutPaise: dto.maxPayoutPaise ?? existing.maxPayoutPaise,
        budgetPaise: dto.budgetPaise ?? existing.budgetPaise,
        brief: dto.brief ?? existing.brief,
      });
    }

    const brief =
      dto.brief !== undefined
        ? dto.brief
        : this.buildBrief({
            briefHook: dto.briefHook ?? existing.briefHook ?? undefined,
            doRules: dto.doRules ?? existing.doRules ?? undefined,
            avoidRules: dto.avoidRules ?? existing.avoidRules ?? undefined,
          }) || existing.brief;

    const platforms = dto.platforms
      ? normalizeCampaignPlatforms(dto.platforms)
      : undefined;

    const campaign = await this.prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status: dto.status,
        title: dto.title,
        category: dto.category,
        brief,
        briefHook: dto.briefHook,
        doRules: dto.doRules,
        avoidRules: dto.avoidRules,
        sourceAssets: dto.sourceAssets as Prisma.InputJsonValue | undefined,
        referenceAssets: dto.referenceAssets as Prisma.InputJsonValue | undefined,
        coverImageUrl: dto.coverImageUrl,
        platforms,
        platform: platforms?.[0],
        productUrl: dto.productUrl,
        ratePer1kPaise: dto.ratePer1kPaise,
        maxPayoutPaise: dto.maxPayoutPaise,
        budgetPaise: dto.budgetPaise,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
      } as Prisma.CampaignUncheckedUpdateInput,
    });
    return this.formatCampaign(campaign);
  }

  async remove(userId: string, role: UserRole, campaignId: string) {
    const existing = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        _count: { select: { submissions: true } },
      },
    });
    if (!existing) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Campaign not found",
      });
    }

    await this.brandAccess.assertCanAccessBrand(
      userId,
      role,
      existing.brandProfileId,
    );

    if (
      existing.status !== CampaignStatus.draft &&
      existing.status !== CampaignStatus.closed
    ) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "End the campaign before deleting it",
      });
    }

    if (existing._count.submissions > 0) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Cannot delete a campaign that has creator submissions",
      });
    }

    await this.prisma.campaign.delete({ where: { id: campaignId } });
    return { deleted: true, id: campaignId };
  }

  private assertStatusTransition(
    from: CampaignStatus,
    to: CampaignStatus,
  ): void {
    if (from === to) return;

    const allowed: Record<CampaignStatus, CampaignStatus[]> = {
      [CampaignStatus.draft]: [CampaignStatus.live, CampaignStatus.closed],
      [CampaignStatus.live]: [CampaignStatus.paused, CampaignStatus.closed],
      [CampaignStatus.paused]: [CampaignStatus.live, CampaignStatus.closed],
      [CampaignStatus.closed]: [],
    };

    if (!allowed[from].includes(to)) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: `Cannot change campaign status from ${from} to ${to}`,
      });
    }
  }

  private assertPublishable(input: {
    title?: string;
    briefHook?: string;
    ratePer1kPaise?: number;
    maxPayoutPaise?: number;
    budgetPaise?: number;
    brief?: string;
  }): void {
    if (!input.title || input.title.trim().length < 3) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Campaign title is required to publish",
      });
    }
    if (!input.briefHook || input.briefHook.trim().length < 10) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Campaign hook must be at least 10 characters to publish",
      });
    }
    if (!input.ratePer1kPaise || input.ratePer1kPaise < 1) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Rate per 1K views is required to publish",
      });
    }
    if (!input.maxPayoutPaise || input.maxPayoutPaise < 100) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Max payout is required to publish",
      });
    }
    if (!input.budgetPaise || input.budgetPaise < 100) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Campaign budget is required to publish",
      });
    }
    const briefText = input.brief?.trim() ?? "";
    if (briefText.length > 0 && briefText.length < 20) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Campaign brief is too short to publish",
      });
    }
  }

  private formatCampaign(c: {
    id: string;
    brandProfileId?: string;
    title: string;
    category: string | null;
    platform: string;
    platforms: string[];
    status: CampaignStatus;
    brief: string;
    briefHook: string | null;
    doRules: string | null;
    avoidRules: string | null;
    sourceAssets: unknown;
    referenceAssets: unknown;
    coverImageUrl?: string | null;
    productUrl: string | null;
    ratePer1kPaise: number;
    maxPayoutPaise: number;
    budgetPaise: number;
    budgetUsedPaise: number;
    startDate: Date | null;
    createdAt: Date;
  }) {
    const poolPercent =
      c.budgetPaise > 0
        ? Math.round((c.budgetUsedPaise / c.budgetPaise) * 100)
        : 0;

    return {
      id: c.id,
      brandProfileId: c.brandProfileId,
      title: c.title,
      category: c.category,
      platform: c.platform,
      platforms: c.platforms,
      status: c.status,
      brief: c.brief,
      briefHook: c.briefHook,
      doRules: c.doRules,
      avoidRules: c.avoidRules,
      sourceAssets: c.sourceAssets,
      referenceAssets: c.referenceAssets,
      coverImageUrl: c.coverImageUrl,
      productUrl: c.productUrl,
      ratePer1kPaise: c.ratePer1kPaise,
      ratePer1kDisplay: `₹${c.ratePer1kPaise / 100} / 1K views`,
      maxPayoutPaise: c.maxPayoutPaise,
      budgetPaise: c.budgetPaise,
      budgetUsedPaise: c.budgetUsedPaise,
      poolPercent,
      poolRemainingPercent: 100 - poolPercent,
      startDate: c.startDate?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
    };
  }

  private buildBrief(dto: {
    brief?: string;
    briefHook?: string;
    doRules?: string;
    avoidRules?: string;
  }): string {
    if (dto.brief && dto.brief.trim().length > 0) {
      return dto.brief.trim();
    }

    const composed = [
      dto.briefHook && `HOOK:\n${dto.briefHook}`,
      dto.doRules && `\n\nDO:\n${dto.doRules}`,
      dto.avoidRules && `\n\nAVOID:\n${dto.avoidRules}`,
    ]
      .filter(Boolean)
      .join("")
      .trim();

    return composed;
  }
}
