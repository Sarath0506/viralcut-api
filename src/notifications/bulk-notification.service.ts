import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { UserRole } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { PushNotificationService } from "./push-notification.service";
import { WhatsappService } from "./whatsapp.service";

function formatLog(log: {
  id: string;
  title: string;
  message: string;
  usedPush: boolean;
  usedWhatsapp: boolean;
  recipientCount: number;
  pushSentCount: number;
  pushFailedCount: number;
  whatsappSentCount: number;
  whatsappFailedCount: number;
  createdAt: Date;
  sentBy: { id: string; displayName: string | null; email: string | null };
}) {
  return {
    id: log.id,
    title: log.title,
    message: log.message,
    usedPush: log.usedPush,
    usedWhatsapp: log.usedWhatsapp,
    recipientCount: log.recipientCount,
    pushSentCount: log.pushSentCount,
    pushFailedCount: log.pushFailedCount,
    whatsappSentCount: log.whatsappSentCount,
    whatsappFailedCount: log.whatsappFailedCount,
    createdAt: log.createdAt.toISOString(),
    sentBy: log.sentBy.displayName ?? log.sentBy.email ?? "Admin",
  };
}

@Injectable()
export class BulkNotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushNotificationService,
    private readonly whatsapp: WhatsappService,
  ) {}

  channelStatus() {
    return {
      pushConfigured: this.push.isConfigured(),
      whatsappConfigured: this.whatsapp.isGeneralTemplateConfigured(),
    };
  }

  async send(
    sentByUserId: string,
    dto: { recipientIds: string[]; usePush: boolean; useWhatsapp: boolean; title: string; message: string },
  ) {
    if (!dto.usePush && !dto.useWhatsapp) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Select at least one channel (push or WhatsApp)",
      });
    }

    const recipients = await this.prisma.user.findMany({
      where: { id: { in: dto.recipientIds }, role: UserRole.creator },
      select: { id: true, displayName: true, username: true, phone: true },
    });
    if (recipients.length === 0) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "No matching creators found" });
    }

    let pushSentCount = 0;
    let pushFailedCount = 0;
    let whatsappSentCount = 0;
    let whatsappFailedCount = 0;

    for (const r of recipients) {
      if (dto.usePush) {
        const result = await this.push.sendToUserWithResult(r.id, {
          title: dto.title,
          body: dto.message,
        });
        if (result.delivered) pushSentCount++;
        else pushFailedCount++;
      }

      if (dto.useWhatsapp) {
        if (!r.phone) {
          whatsappFailedCount++;
        } else {
          try {
            await this.whatsapp.sendGeneralUpdate(r.phone, {
              recipientName: r.displayName ?? r.username ?? "there",
              title: dto.title,
              message: dto.message,
            });
            whatsappSentCount++;
          } catch {
            whatsappFailedCount++;
          }
        }
      }
    }

    const log = await this.prisma.bulkNotificationLog.create({
      data: {
        title: dto.title,
        message: dto.message,
        usedPush: dto.usePush,
        usedWhatsapp: dto.useWhatsapp,
        recipientIds: recipients.map((r) => r.id),
        recipientCount: recipients.length,
        pushSentCount,
        pushFailedCount,
        whatsappSentCount,
        whatsappFailedCount,
        sentByUserId,
      },
      include: { sentBy: { select: { id: true, displayName: true, email: true } } },
    });

    return formatLog(log);
  }

  async listHistory(page = 1, limit = 20) {
    const take = Math.min(limit, 50);
    const [items, total] = await Promise.all([
      this.prisma.bulkNotificationLog.findMany({
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * take,
        take,
        include: { sentBy: { select: { id: true, displayName: true, email: true } } },
      }),
      this.prisma.bulkNotificationLog.count(),
    ]);
    return {
      items: items.map(formatLog),
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / take)),
    };
  }
}
