import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class ActivityLogService {
  private readonly logger = new Logger(ActivityLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(
    actorUserId: string,
    action: string,
    opts: {
      targetType: string;
      targetId: string;
      brandProfileId?: string;
      metadata?: Prisma.InputJsonValue;
    },
  ): Promise<void> {
    try {
      await this.prisma.activityLog.create({
        data: {
          actorUserId,
          action,
          targetType: opts.targetType,
          targetId: opts.targetId,
          brandProfileId: opts.brandProfileId,
          metadata: opts.metadata,
        },
      });
    } catch (error) {
      // Logging must never break the action it's recording.
      this.logger.error(`Failed to write activity log for action "${action}"`, error as Error);
    }
  }
}
