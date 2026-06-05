import { describe, expect, it, vi } from "vitest";

import { FixedOtpService } from "./fixed-otp.service";

describe("FixedOtpService", () => {
  it("returns fixed code when user has fixedOtpCode in DB", async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ fixedOtpCode: "000000" }),
      },
    };
    const service = new FixedOtpService(prisma as never);
    await expect(service.getFixedCodeForPhone("+916281068402")).resolves.toBe(
      "000000",
    );
  });

  it("returns null when user has no fixed OTP", async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ fixedOtpCode: null }),
      },
    };
    const service = new FixedOtpService(prisma as never);
    await expect(service.getFixedCodeForPhone("+919999999999")).resolves.toBeNull();
  });
});
