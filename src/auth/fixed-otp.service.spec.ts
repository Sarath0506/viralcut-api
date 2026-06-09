import { describe, expect, it, vi } from "vitest";

import { FixedOtpService } from "./fixed-otp.service";

function makeService(
  prisma: { user: { findUnique: ReturnType<typeof vi.fn> } },
  env: { NODE_ENV?: string; OTP_DEV_BYPASS_CODE?: string } = {},
) {
  const config = {
    get: vi.fn((key: string) => {
      if (key === "NODE_ENV") return env.NODE_ENV ?? "development";
      if (key === "OTP_DEV_BYPASS_CODE") return env.OTP_DEV_BYPASS_CODE;
      return undefined;
    }),
  };
  return new FixedOtpService(prisma as never, config as never);
}

describe("FixedOtpService", () => {
  it("returns dev bypass code for any phone in development", async () => {
    const prisma = {
      user: { findUnique: vi.fn() },
    };
    const service = makeService(prisma, { OTP_DEV_BYPASS_CODE: "000000" });
    await expect(service.getFixedCodeForPhone("+919999999999")).resolves.toBe(
      "000000",
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("returns fixed code when user has fixedOtpCode in DB", async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ fixedOtpCode: "000000" }),
      },
    };
    const service = makeService(prisma, {});
    await expect(service.getFixedCodeForPhone("+916281068402")).resolves.toBe(
      "000000",
    );
  });

  it("returns null when user has no fixed OTP and no dev bypass", async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ fixedOtpCode: null }),
      },
    };
    const service = makeService(prisma, { NODE_ENV: "production" });
    await expect(service.getFixedCodeForPhone("+919999999999")).resolves.toBeNull();
  });
});
