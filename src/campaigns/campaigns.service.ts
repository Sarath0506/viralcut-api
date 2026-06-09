import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  CampaignInviteStatus,
  CampaignOwnership,
  CampaignStatus,
  CampaignWizardStep,
  Prisma,
  UserRole,
} from "@prisma/client";

import { CampaignAccessService } from "../access/campaign-access.service";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeService } from "../realtime/realtime.service";
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
    private readonly campaignAccess: CampaignAccessService,
    private readonly realtime: RealtimeService,
  ) {}

  async listLiveForCreators() {
    const campaigns = await this.prisma.campaign.findMany({
      where: { status: CampaignStatus.live },
      orderBy: { createdAt: "desc" },
      include: {
        brandProfile: { select: { companyName: true, logoUrl: true } },
      },
    });
    return campaigns.map((c) => this.formatCampaignForCreator(c));
  }

  async getLiveForCreator(campaignId: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, status: CampaignStatus.live },
      include: {
        brandProfile: { select: { companyName: true, logoUrl: true } },
      },
    });
    if (!campaign) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Campaign not found",
      });
    }
    return this.formatCampaignForCreator(campaign);
  }

  async listForUser(
    userId: string,
    role: UserRole,
    query: ListCampaignsQueryDto,
  ) {
    const brandProfileId =
      role === UserRole.brand
        ? await this.campaignAccess.getBrandProfileIdForUser(userId)
        : null;

    const page = query.page ?? 1;
    const limit = query.limit ?? 6;
    const skip = (page - 1) * limit;

    const where: Prisma.CampaignWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(role === UserRole.brand && brandProfileId
        ? { brandProfileId }
        : {}),
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
          invites: {
            where: { status: CampaignInviteStatus.pending },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      }),
    ]);

    return {
      items: campaigns.map((c) => ({
        ...this.formatCampaign(c),
        brandCompanyName: c.brandProfile?.companyName ?? null,
        submissionCount: c._count.submissions,
        pendingInviteEmail: c.invites[0]?.email ?? null,
      })),
      total,
      page,
      limit,
    };
  }

  async getForUser(userId: string, role: UserRole, campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        _count: { select: { submissions: true } },
        brandProfile: { select: { id: true, companyName: true } },
        invites: {
          where: { status: CampaignInviteStatus.pending },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
    if (!campaign) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Campaign not found",
      });
    }

    await this.campaignAccess.assertCanAccessCampaign(userId, role, campaign);

    return {
      ...this.formatCampaign(campaign),
      brandCompanyName: campaign.brandProfile?.companyName ?? null,
      submissionCount: campaign._count.submissions,
      pendingInviteEmail: campaign.invites[0]?.email ?? null,
    };
  }

  async create(userId: string, role: UserRole, dto: CreateCampaignDto) {
    const status = dto.status ?? CampaignStatus.draft;
    const isLive = status === CampaignStatus.live;

    let brandProfileId: string | null = null;
    let ownership: CampaignOwnership = CampaignOwnership.brand_created;

    if (role === UserRole.admin) {
      ownership = CampaignOwnership.admin_created;
      brandProfileId = null;
    } else {
      brandProfileId =
        await this.campaignAccess.resolveBrandProfileIdForBrandCreate(
          userId,
          role,
        );
    }

    if (isLive) {
      this.assertPublishable(dto);
      if (ownership === CampaignOwnership.admin_created) {
        this.assertAdminCanPublish({
          ownership,
          brandProfileId,
          inviteAcceptedAt: null,
        });
      }
    }

    const platforms = normalizeCampaignPlatforms(dto.platforms, dto.platform);
    const brief =
      this.buildBrief(dto) ||
      (isLive ? "" : "Draft campaign — complete before publishing.");

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
        ownership,
        wizardStep: dto.wizardStep ?? CampaignWizardStep.basics,
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
      },
    });

    const formatted = this.formatCampaign(campaign);
    if (isLive) {
      this.realtime.emitCampaignPublished(formatted);
    } else {
      this.realtime.emitCampaignCreated(formatted);
    }
    return formatted;
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

    await this.campaignAccess.assertCanAccessCampaign(
      userId,
      role,
      existing,
    );

    const nextStatus = dto.status ?? existing.status;
    if (dto.status && dto.status !== existing.status) {
      this.assertStatusTransition(existing.status, dto.status);
    }

    if (
      nextStatus === CampaignStatus.live &&
      existing.status !== CampaignStatus.live
    ) {
      this.assertPublishable({
        title: dto.title ?? existing.title,
        briefHook: dto.briefHook ?? existing.briefHook ?? undefined,
        ratePer1kPaise: dto.ratePer1kPaise ?? existing.ratePer1kPaise,
        maxPayoutPaise: dto.maxPayoutPaise ?? existing.maxPayoutPaise,
        budgetPaise: dto.budgetPaise ?? existing.budgetPaise,
        brief: dto.brief ?? existing.brief,
      });
      this.assertAdminCanPublish({
        ownership: existing.ownership,
        brandProfileId: existing.brandProfileId,
        inviteAcceptedAt: existing.inviteAcceptedAt,
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
        wizardStep: dto.wizardStep,
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
      },
    });

    const formatted = this.formatCampaign(campaign);
    if (
      nextStatus === CampaignStatus.live &&
      existing.status !== CampaignStatus.live
    ) {
      this.realtime.emitCampaignPublished(formatted);
    } else {
      this.realtime.emitCampaignUpdated(formatted);
    }
    return formatted;
  }

  async remove(userId: string, role: UserRole, campaignId: string) {
    const existing = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { _count: { select: { submissions: true } } },
    });
    if (!existing) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Campaign not found",
      });
    }

    await this.campaignAccess.assertCanAccessCampaign(
      userId,
      role,
      existing,
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

  private assertAdminCanPublish(campaign: {
    ownership?: CampaignOwnership;
    brandProfileId: string | null;
    inviteAcceptedAt: Date | null;
  }): void {
    if (campaign.ownership !== CampaignOwnership.admin_created) {
      return;
    }
    if (!campaign.brandProfileId || !campaign.inviteAcceptedAt) {
      throw new ForbiddenException({
        code: "PUBLISH_BLOCKED_PENDING_INVITE",
        message: "Invite a brand and wait for acceptance before publishing",
      });
    }
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
  }

  formatCampaignForCreator(
    c: Parameters<CampaignsService["formatCampaign"]>[0] & {
      brandProfile?: { companyName: string; logoUrl: string | null } | null;
    },
  ) {
    return {
      ...this.formatCampaign(c),
      brandCompanyName: c.brandProfile?.companyName ?? null,
      brandLogoUrl: c.brandProfile?.logoUrl ?? null,
    };
  }

  formatCampaign(c: {
    id: string;
    brandProfileId?: string | null;
    ownership?: CampaignOwnership;
    wizardStep?: CampaignWizardStep;
    inviteAcceptedAt?: Date | null;
    createdByUserId?: string | null;
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
    updatedAt?: Date;
  }) {
    const poolPercent =
      c.budgetPaise > 0
        ? Math.round((c.budgetUsedPaise / c.budgetPaise) * 100)
        : 0;

    return {
      id: c.id,
      brandProfileId: c.brandProfileId ?? null,
      ownership: c.ownership ?? CampaignOwnership.brand_created,
      wizardStep: c.wizardStep ?? CampaignWizardStep.basics,
      inviteAcceptedAt: c.inviteAcceptedAt?.toISOString() ?? null,
      createdByUserId: c.createdByUserId ?? null,
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
      updatedAt: c.updatedAt?.toISOString() ?? c.createdAt.toISOString(),
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

