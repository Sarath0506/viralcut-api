import { Injectable } from "@nestjs/common";

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

  async getWallet(userId: string) {
    const wallet = await this.getOrCreateWallet(userId);
    return {
      availablePaise: wallet.availablePaise,
      pendingPaise: wallet.pendingPaise,
      lifetimePaise: wallet.lifetimePaise,
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
