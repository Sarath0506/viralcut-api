import { Injectable, Logger } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import type { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { PushNotificationService } from "./push-notification.service";

type CreateNotificationInput = {
  type: string;
  title: string;
  body?: string;
  link?: string;
  metadata?: Prisma.InputJsonValue;
};

function formatNotification(n: {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: Date;
}) {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link,
    read: n.read,
    createdAt: n.createdAt.toISOString(),
  };
}

@Injectable()
export class InAppNotificationService {
  private readonly logger = new Logger(InAppNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: RealtimeGateway,
    private readonly push: PushNotificationService,
  ) {}

  async create(
    recipientUserId: string,
    role: "admin" | "staff" | "brand" | "creator",
    input: CreateNotificationInput,
    brandProfileId?: string,
  ): Promise<void> {
    try {
      const notification = await this.prisma.notification.create({
        data: {
          recipientUserId,
          type: input.type,
          title: input.title,
          body: input.body,
          link: input.link,
          metadata: input.metadata,
        },
      });

      const payload = formatNotification(notification);
      if (role === "admin") {
        this.gateway.emitToAdmin("notification:new", payload);
      } else if (role === "staff") {
        this.gateway.emitToStaff(recipientUserId, "notification:new", payload);
      } else if (role === "creator") {
        this.gateway.emitToCreator(recipientUserId, "notification:new", payload);
      } else if (brandProfileId) {
        this.gateway.emitToBrand(brandProfileId, "notification:new", payload);
      }

      await this.push.sendToUser(recipientUserId, {
        title: input.title,
        body: input.body,
        data: input.link ? { link: input.link } : undefined,
      });
    } catch (error) {
      // Notifications must never break the action that triggered them.
      this.logger.error(`Failed to create notification "${input.type}" for ${recipientUserId}`, error as Error);
    }
  }

  async notifyAllAdmins(input: CreateNotificationInput): Promise<void> {
    const admins = await this.prisma.user.findMany({
      where: { role: UserRole.admin },
      select: { id: true },
    });
    await Promise.all(admins.map((a) => this.create(a.id, "admin", input)));
  }

  async listForUser(userId: string, opts?: { unreadOnly?: boolean; limit?: number }) {
    const notifications = await this.prisma.notification.findMany({
      where: {
        recipientUserId: userId,
        ...(opts?.unreadOnly ? { read: false } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: opts?.limit ?? 30,
    });
    return notifications.map(formatNotification);
  }

  async countUnread(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { recipientUserId: userId, read: false },
    });
  }

  async markRead(userId: string, notificationId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { id: notificationId, recipientUserId: userId },
      data: { read: true, readAt: new Date() },
    });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { recipientUserId: userId, read: false },
      data: { read: true, readAt: new Date() },
    });
  }
}
