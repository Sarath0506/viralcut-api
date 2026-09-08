import { Injectable, Logger } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";
import type { ChecklistItem } from "./auto-review.types";
import { GeminiService } from "./gemini.service";

@Injectable()
export class ChecklistService {
  private readonly logger = new Logger(ChecklistService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gemini: GeminiService,
  ) {}

  /** Returns the campaign's cached compliance checklist, deriving and
   * persisting it on first use so every deliverable in a campaign is judged
   * against the same criteria rather than a freshly-regenerated (and
   * possibly different) one on every single review. */
  async getOrCreateChecklist(campaignId: string): Promise<ChecklistItem[] | null> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { brief: true, doRules: true, avoidRules: true, complianceChecklist: true },
    });
    if (!campaign) return null;

    const cached = campaign.complianceChecklist as ChecklistItem[] | null;
    if (cached && Array.isArray(cached) && cached.length > 0) {
      return cached;
    }

    const derived = await this.gemini.deriveChecklist({
      brief: campaign.brief,
      doRules: campaign.doRules,
      avoidRules: campaign.avoidRules,
    });
    if (!derived || derived.length === 0) {
      this.logger.warn(`Could not derive a compliance checklist for campaign ${campaignId}`);
      return null;
    }

    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { complianceChecklist: derived },
    });
    return derived;
  }
}
