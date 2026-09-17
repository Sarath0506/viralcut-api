import { describe, expect, it, vi } from "vitest";

import { ensureVerifiedCreatorId } from "./verified-creator-id";

function makePrisma() {
  return {
    user: { findUnique: vi.fn(), update: vi.fn() },
  };
}

describe("ensureVerifiedCreatorId", () => {
  it("does nothing when the user already has one — permanent, never reassigned", async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({ verifiedCreatorId: "123456789" });

    await ensureVerifiedCreatorId(prisma as never, "user-1");

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("assigns a 9-digit id when the user doesn't have one yet", async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({ verifiedCreatorId: null });
    prisma.user.update.mockResolvedValue({});

    await ensureVerifiedCreatorId(prisma as never, "user-1");

    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    const data = prisma.user.update.mock.calls[0][0].data;
    expect(data.verifiedCreatorId).toMatch(/^\d{9}$/);
    expect(Number(data.verifiedCreatorId)).toBeGreaterThanOrEqual(100_000_000);
    expect(Number(data.verifiedCreatorId)).toBeLessThanOrEqual(999_999_999);
  });

  it("retries on a unique-constraint collision instead of failing outright", async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({ verifiedCreatorId: null });
    prisma.user.update
      .mockRejectedValueOnce({ code: "P2002" })
      .mockRejectedValueOnce({ code: "P2002" })
      .mockResolvedValueOnce({});

    await ensureVerifiedCreatorId(prisma as never, "user-1");

    expect(prisma.user.update).toHaveBeenCalledTimes(3);
  });

  it("gives up and rethrows after repeated collisions", async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({ verifiedCreatorId: null });
    prisma.user.update.mockRejectedValue({ code: "P2002" });

    await expect(ensureVerifiedCreatorId(prisma as never, "user-1")).rejects.toEqual({ code: "P2002" });
    expect(prisma.user.update).toHaveBeenCalledTimes(5);
  });

  it("rethrows immediately on a non-collision error, without retrying", async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({ verifiedCreatorId: null });
    prisma.user.update.mockRejectedValue(new Error("db down"));

    await expect(ensureVerifiedCreatorId(prisma as never, "user-1")).rejects.toThrow("db down");
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
  });
});
