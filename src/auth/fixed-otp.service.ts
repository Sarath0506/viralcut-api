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

  // App Store / Play Store reviewer test account — works in ALL environments.
  // Reviewers cannot receive real WhatsApp OTPs during the review process.
  private static readonly REVIEWER_ACCOUNTS: Record<string, string> = {
    "+919876543211": "000000",
  };

  /**
   * Fixed OTP from three mechanisms (checked in order):
   * 1. REVIEWER_ACCOUNTS — hardcoded test phones that work in all environments.
   * 2. OTP_DEV_BYPASS_CODE — any valid +91 phone in NODE_ENV=development only.
   * 3. User.fixedOtpCode — per-account static OTP (demo seed users); works in all envs.
   */
  async getFixedCodeForPhone(phone: string): Promise<string | null> {
    const reviewerCode = FixedOtpService.REVIEWER_ACCOUNTS[phone];
    if (reviewerCode) return reviewerCode;

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
