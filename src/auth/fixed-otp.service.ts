import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class FixedOtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Fixed OTP from two mechanisms:
   * 1. OTP_DEV_BYPASS_CODE — any valid +91 phone in NODE_ENV=development only.
   * 2. User.fixedOtpCode — per-account static OTP (demo seed users); works in all envs.
   */
  async getFixedCodeForPhone(phone: string): Promise<string | null> {
    const devBypass = this.getDevBypassCode();
    if (devBypass) return devBypass;

    const user = await this.prisma.user.findUnique({
      where: { phone },
      select: { fixedOtpCode: true },
    });
    const code = user?.fixedOtpCode?.trim();
    return code && code.length === 6 ? code : null;
  }

  private getDevBypassCode(): string | null {
    if (this.config.get("NODE_ENV", { infer: true }) !== "development") {
      return null;
    }
    const code = this.config.get("OTP_DEV_BYPASS_CODE", { infer: true });
    return code?.trim() || null;
  }
}
