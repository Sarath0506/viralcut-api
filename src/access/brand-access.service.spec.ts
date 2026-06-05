import { ForbiddenException } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BrandAccessService } from "./brand-access.service";

describe("BrandAccessService", () => {
  const prisma = {
    brandMembership: { findMany: vi.fn() },
    agencyMembership: { findFirst: vi.fn() },
    agencyBrand: { findMany: vi.fn(), findFirst: vi.fn() },
  };

  const service = new BrandAccessService(prisma as never);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists brand profile ids for brand users", async () => {
    vi.mocked(prisma.brandMembership.findMany).mockResolvedValue([
      { brandProfileId: "bp1" },
    ]);
    const ids = await service.listAccessibleBrandProfileIds("u1", UserRole.brand);
    expect(ids).toEqual(["bp1"]);
  });

  it("lists brand profile ids for agency users via active links", async () => {
    vi.mocked(prisma.agencyMembership.findFirst).mockResolvedValue({
      agencyId: "ag1",
    });
    vi.mocked(prisma.agencyBrand.findMany).mockResolvedValue([
      { brandProfileId: "bp1" },
      { brandProfileId: "bp2" },
    ]);
    const ids = await service.listAccessibleBrandProfileIds("u1", UserRole.agency);
    expect(ids).toEqual(["bp1", "bp2"]);
  });

  it("throws when agency cannot access brand", async () => {
    vi.mocked(prisma.brandMembership.findMany).mockResolvedValue([]);
    vi.mocked(prisma.agencyMembership.findFirst).mockResolvedValue({
      agencyId: "ag1",
    });
    vi.mocked(prisma.agencyBrand.findMany).mockResolvedValue([
      { brandProfileId: "bp1" },
    ]);
    await expect(
      service.assertCanAccessBrand("u1", UserRole.agency, "bp_other"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
