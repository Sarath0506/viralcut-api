import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as bcrypt from "bcryptjs";
import { createHash, randomInt } from "node:crypto";

import type { Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { WhatsappService } from "../notifications/whatsapp.service";
import { FixedOtpService } from "./fixed-otp.service";

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly whatsapp: WhatsappService,
    private readonly fixedOtp: FixedOtpService,
  ) {}

  async requestOtp(phone: string): Promise<{ expiresInSeconds: number }> {
    const recent = await this.prisma.otpSession.count({
      where: {
        phone,
        createdAt: { gte: new Date(Date.now() - 60_000) },
      },
    });
    if (recent >= 1) {
      throw new HttpException(
        {
          code: "RATE_LIMITED",
          message: "Wait before requesting another OTP",
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.prisma.otpSession.deleteMany({ where: { phone } });

    const fixedCode = await this.fixedOtp.getFixedCodeForPhone(phone);
    const code = fixedCode ?? randomInt(100_000, 999_999).toString();
    const codeHash = await bcrypt.hash(code, 10);
    const ttl = this.config.get("OTP_TTL_SECONDS", { infer: true });
    const expiresAt = new Date(Date.now() + ttl * 1000);

    await this.prisma.otpSession.create({
      data: { phone, codeHash, expiresAt },
    });

    if (fixedCode) {
      this.logger.log(
        `Fixed OTP profile ${phone} — enter ${fixedCode} (no WhatsApp)`,
      );
      return { expiresInSeconds: ttl };
    }

    try {
      await this.whatsapp.sendOtp(phone, code);
    } catch {
      this.logger.error(`Failed to deliver OTP to ${phone}`);
      throw new BadRequestException({
        code: "INTERNAL_ERROR",
        message: "Could not send OTP. Try again later.",
      });
    }

    return { expiresInSeconds: ttl };
  }

  async verifyOtp(phone: string, code: string): Promise<void> {
    const fixedCode = await this.fixedOtp.getFixedCodeForPhone(phone);
    if (fixedCode && code === fixedCode) {
      await this.prisma.otpSession.deleteMany({ where: { phone } });
      return;
    }

    const session = await this.prisma.otpSession.findFirst({
      where: { phone },
      orderBy: { createdAt: "desc" },
    });

    if (!session || session.expiresAt < new Date()) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "OTP expired or not found",
      });
    }

    const maxAttempts = this.config.get("OTP_MAX_ATTEMPTS", { infer: true });
    if (session.attempts >= maxAttempts) {
      throw new HttpException(
        {
          code: "RATE_LIMITED",
          message: "Too many OTP attempts",
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const valid = await bcrypt.compare(code, session.codeHash);
    if (!valid) {
      await this.prisma.otpSession.update({
        where: { id: session.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Invalid OTP",
      });
    }

    await this.prisma.otpSession.delete({ where: { id: session.id } });
  }
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
