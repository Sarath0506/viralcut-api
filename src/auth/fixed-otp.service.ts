import { Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class FixedOtpService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns the fixed OTP for this phone if the user row has one configured. */
  async getFixedCodeForPhone(phone: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { phone },
      select: { fixedOtpCode: true },
    });
    const code = user?.fixedOtpCode?.trim();
    return code && code.length === 6 ? code : null;
  }
}
