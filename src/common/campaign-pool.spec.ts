import { describe, expect, it, vi } from "vitest";

import { getCampaignPoolUsage, getCampaignPoolUsageMap } from "./campaign-pool";

describe("getCampaignPoolUsage", () => {
  it("returns the capped total from the query", async () => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([{ total: 125000n }]) };
    const total = await getCampaignPoolUsage(prisma as never, "campaign-1");
    expect(total).toBe(125000);
  });

  it("returns 0 when the campaign has no deliverables yet", async () => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([{ total: 0n }]) };
    const total = await getCampaignPoolUsage(prisma as never, "campaign-1");
    expect(total).toBe(0);
  });

  it("returns 0 when the query returns no row at all", async () => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([]) };
    const total = await getCampaignPoolUsage(prisma as never, "campaign-1");
    expect(total).toBe(0);
  });
});

describe("getCampaignPoolUsageMap", () => {
  it("maps each campaign id to its total", async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([
        { campaign_id: "c1", total: 5000n },
        { campaign_id: "c2", total: 0n },
      ]),
    };
    const map = await getCampaignPoolUsageMap(prisma as never, ["c1", "c2"]);
    expect(map).toEqual({ c1: 5000, c2: 0 });
  });

  it("short-circuits without querying for an empty id list", async () => {
    const prisma = { $queryRaw: vi.fn() };
    const map = await getCampaignPoolUsageMap(prisma as never, []);
    expect(map).toEqual({});
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
