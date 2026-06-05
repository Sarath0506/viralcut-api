import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { WithdrawalStatus } from "@prisma/client";
function computeWithdrawalFeePaise(
  amountPaise: number,
  feeBps: number,
): number {
  return Math.floor((amountPaise * feeBps) / 10000);
}

import type { Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import type { CreatePayoutMethodDto, CreateWithdrawalDto } from "./dto/payout.dto";

@Injectable()
export class PayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  maskAccount(account: string): string {
    if (account.includes("@")) {
      const [user, domain] = account.split("@");
      return `${user.slice(0, 2)}***@${domain}`;
    }
    return `•••• ${account.slice(-4)}`;
  }

  async listPayoutMethods(userId: string) {
    const methods = await this.prisma.payoutMethod.findMany({
      where: { userId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });
    return methods.map((m) => ({
      id: m.id,
      type: m.type,
      label: m.label,
      accountMasked: m.accountMasked,
      isDefault: m.isDefault,
    }));
  }

  async createPayoutMethod(userId: string, dto: CreatePayoutMethodDto) {
    const count = await this.prisma.payoutMethod.count({ where: { userId } });
    const isDefault = count === 0;

    const method = await this.prisma.payoutMethod.create({
      data: {
        userId,
        type: dto.type,
        label: dto.label,
        accountMasked: this.maskAccount(dto.account),
        isDefault,
      },
    });

    return {
      id: method.id,
      type: method.type,
      label: method.label,
      accountMasked: method.accountMasked,
      isDefault: method.isDefault,
    };
  }

  async setDefaultPayoutMethod(userId: string, methodId: string) {
    const method = await this.prisma.payoutMethod.findFirst({
      where: { id: methodId, userId },
    });
    if (!method) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Payout method not found",
      });
    }

    await this.prisma.$transaction([
      this.prisma.payoutMethod.updateMany({
        where: { userId },
        data: { isDefault: false },
      }),
      this.prisma.payoutMethod.update({
        where: { id: methodId },
        data: { isDefault: true },
      }),
    ]);

    return { ok: true };
  }

  async deletePayoutMethod(userId: string, methodId: string) {
    const method = await this.prisma.payoutMethod.findFirst({
      where: { id: methodId, userId },
    });
    if (!method) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Payout method not found",
      });
    }

    await this.prisma.payoutMethod.delete({ where: { id: methodId } });

    if (method.isDefault) {
      const next = await this.prisma.payoutMethod.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
      });
      if (next) {
        await this.prisma.payoutMethod.update({
          where: { id: next.id },
          data: { isDefault: true },
        });
      }
    }

    return { ok: true };
  }

  async createWithdrawal(userId: string, dto: CreateWithdrawalDto) {
    if (dto.idempotencyKey) {
      const existing = await this.prisma.withdrawal.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
      });
      if (existing && existing.userId === userId) {
        return this.formatWithdrawal(existing);
      }
      if (existing) {
        throw new ConflictException({
          code: "CONFLICT",
          message: "Idempotency key already used",
        });
      }
    }

    const payoutMethod = await this.prisma.payoutMethod.findFirst({
      where: { id: dto.payoutMethodId, userId },
    });
    if (!payoutMethod) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Payout method not found",
      });
    }

    const feeBps = this.config.get("WITHDRAWAL_FEE_BPS", { infer: true });
    const feePaise = computeWithdrawalFeePaise(dto.amountPaise, feeBps);
    const netPaise = dto.amountPaise - feePaise;

    if (netPaise <= 0) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Withdrawal amount too small after fee",
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet || wallet.availablePaise < dto.amountPaise) {
        throw new BadRequestException({
          code: "VALIDATION_ERROR",
          message: "Insufficient available balance",
        });
      }

      const withdrawal = await tx.withdrawal.create({
        data: {
          userId,
          amountPaise: dto.amountPaise,
          feePaise,
          netPaise,
          payoutMethodId: dto.payoutMethodId,
          idempotencyKey: dto.idempotencyKey,
          status: WithdrawalStatus.processing,
        },
      });

      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          availablePaise: { decrement: dto.amountPaise },
        },
      });

      await tx.transaction.create({
        data: {
          walletId: wallet.id,
          type: "withdrawal_debit",
          amountPaise: dto.amountPaise,
          referenceId: withdrawal.id,
          note: `Withdrawal (fee ${feePaise} paise, net ${netPaise} paise)`,
        },
      });

      const completed = await tx.withdrawal.update({
        where: { id: withdrawal.id },
        data: {
          status: WithdrawalStatus.completed,
          processedAt: new Date(),
        },
      });

      return this.formatWithdrawal(completed);
    });
  }

  async listWithdrawals(userId: string, limit = 20) {
    const items = await this.prisma.withdrawal.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 50),
    });
    return { items: items.map((w) => this.formatWithdrawal(w)) };
  }

  private formatWithdrawal(w: {
    id: string;
    amountPaise: number;
    feePaise: number;
    netPaise: number;
    status: WithdrawalStatus;
    createdAt: Date;
  }) {
    return {
      id: w.id,
      amountPaise: w.amountPaise,
      feePaise: w.feePaise,
      netPaise: w.netPaise,
      status: w.status,
      createdAt: w.createdAt.toISOString(),
    };
  }
}
