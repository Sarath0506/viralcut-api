import { Injectable, Logger } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";

type PushPayload = {
  title: string;
  body?: string;
  data?: Record<string, string>;
};

/**
 * Push delivery is not wired to a real provider yet — sending requires a
 * Firebase project (Android + iOS) and an APNs key, which must come from
 * the account owner. Until then this only logs what *would* be sent, so
 * every notification path is already push-ready: swap sendToTokens() for a
 * real FCM/APNs call and no other code needs to change.
 */
@Injectable()
export class PushNotificationService {
  private readonly logger = new Logger(PushNotificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Always false until a real FCM/APNs provider is wired in sendToTokens(). */
  isConfigured(): boolean {
    return false;
  }

  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    const tokens = await this.prisma.deviceToken.findMany({
      where: { userId },
      select: { token: true, platform: true },
    });
    if (tokens.length === 0) return;
    await this.sendToTokens(tokens, payload);
  }

  /** Like sendToUser, but reports whether delivery actually happened —
   * used by bulk sends that need accurate sent/failed counts rather than
   * the fire-and-forget behavior sendToUser's callers rely on elsewhere. */
  async sendToUserWithResult(
    userId: string,
    payload: PushPayload,
  ): Promise<{ delivered: boolean; reason?: string }> {
    if (!this.isConfigured()) {
      return { delivered: false, reason: "Push not configured" };
    }
    const tokens = await this.prisma.deviceToken.findMany({
      where: { userId },
      select: { token: true, platform: true },
    });
    if (tokens.length === 0) {
      return { delivered: false, reason: "No registered device" };
    }
    await this.sendToTokens(tokens, payload);
    return { delivered: true };
  }

  private async sendToTokens(
    tokens: { token: string; platform: string }[],
    payload: PushPayload,
  ): Promise<void> {
    this.logger.log(
      `[push:stub] Would send "${payload.title}" to ${tokens.length} device(s): ${tokens
        .map((t) => `${t.platform}:${t.token.slice(0, 8)}…`)
        .join(", ")}`,
    );
  }

  async registerToken(userId: string, token: string, platform: string): Promise<void> {
    await this.prisma.deviceToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform },
    });
  }

  async unregisterToken(token: string): Promise<void> {
    await this.prisma.deviceToken.deleteMany({ where: { token } });
  }
}
