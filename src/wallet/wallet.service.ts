import { Injectable } from "@nestjs/common";
import { FormatDeliverableStatus } from "@prisma/client";

import { computeEstimatedPaise } from "../common/earnings";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreateWallet(userId: string) {
    let wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      wallet = await this.prisma.wallet.create({ data: { userId } });
    }
    return wallet;
  }

  // Earnings that are "in flight" — the creator has done their part
  // (submitted live proof or had proof approved) but payout hasn't settled yet.
  async computePendingPaise(creatorId: string, creatorProfileId?: string): Promise<number> {
    const pendingStatuses = [
      FormatDeliverableStatus.live_submitted,
      FormatDeliverableStatus.proof_under_review,
      FormatDeliverableStatus.proof_approved,
    ];
    const deliverables = await this.prisma.formatDeliverable.findMany({
      where: {
        status: { in: pendingStatuses },
        paidAt: null,
        participation: { creatorId, ...(creatorProfileId ? { creatorProfileId } : {}) },
      },
      include: {
        participation: {
          include: {
            campaign: { select: { ratePer1kPaise: true, maxPayoutPaise: true } },
          },
        },
      },
    });
    return deliverables.reduce((sum, d) => {
      return sum + computeEstimatedPaise(
        d.viewCount,
        d.participation.campaign.ratePer1kPaise,
        d.participation.campaign.maxPayoutPaise,
      );
    }, 0);
  }

  async countClipsUnderReview(creatorId: string, creatorProfileId?: string): Promise<number> {
    return this.prisma.formatDeliverable.count({
      where: {
        status: FormatDeliverableStatus.under_review,
        participation: { creatorId, ...(creatorProfileId ? { creatorProfileId } : {}) },
      },
    });
  }

  async getWallet(userId: string, creatorProfileId?: string) {
    const [wallet, pendingPaise, clipsUnderReview] = await Promise.all([
      this.getOrCreateWallet(userId),
      this.computePendingPaise(userId, creatorProfileId),
      this.countClipsUnderReview(userId, creatorProfileId),
    ]);
    return {
      availablePaise: wallet.availablePaise,
      pendingPaise,
      lifetimePaise: wallet.lifetimePaise,
      clipsUnderReview,
    };
  }

  async listTransactions(userId: string, limit = 20, cursor?: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      return { items: [], nextCursor: null };
    }

    const items = await this.prisma.transaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor
        ? { cursor: { id: cursor }, skip: 1 }
        : {}),
    });

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;

    return {
      items: page.map((t) => ({
        id: t.id,
        type: t.type,
        amountPaise: t.amountPaise,
        note: t.note,
        createdAt: t.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    };
  }

  async creditEarning(
    userId: string,
    amountPaise: number,
    referenceId: string,
    note?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.upsert({
        where: { userId },
        create: { userId },
        update: {},
      });

      const updated = await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          availablePaise: { increment: amountPaise },
          lifetimePaise: { increment: amountPaise },
        },
      });

      await tx.transaction.create({
        data: {
          walletId: wallet.id,
          type: "earning_credit",
          amountPaise,
          referenceId,
          note,
        },
      });

      return updated;
    });
  }
}
