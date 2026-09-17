import { CampaignOwnership, CampaignStatus, CampaignWizardStep, NewClipperIntakeStatus, UserRole } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { CampaignsService } from "./campaigns.service";

function makePrisma() {
  return { user: { findMany: vi.fn().mockResolvedValue([]) } };
}

function makeNotifications() {
  return { create: vi.fn().mockResolvedValue(undefined) };
}

function makeService(prisma: ReturnType<typeof makePrisma> = makePrisma(), notifications: ReturnType<typeof makeNotifications> = makeNotifications()) {
  return new CampaignsService(prisma as never, {} as never, {} as never, {} as never, notifications as never);
}

function baseCampaign(overrides: Partial<Parameters<CampaignsService["formatCampaign"]>[0]> = {}) {
  return {
    id: "camp-1",
    ownership: CampaignOwnership.brand_created,
    wizardStep: CampaignWizardStep.basics,
    title: "Test",
    category: null,
    platform: "instagram_reel",
    platforms: ["instagram_reel"],
    locationType: "all_india",
    targetStates: [],
    status: CampaignStatus.live,
    brief: "",
    briefHook: null,
    doRules: null,
    avoidRules: null,
    sourceAssets: [],
    referenceAssets: [],
    productUrl: null,
    ratePer1kPaise: 5000,
    maxPayoutPaise: 5000000,
    budgetPaise: 10000000,
    budgetUsedPaise: 0,
    startDate: null,
    createdAt: new Date("2026-08-01"),
    ...overrides,
  };
}

describe("CampaignsService.formatCampaign", () => {
  it("keeps intake open when usage is below the pool threshold", () => {
    const service = makeService();
    const result = service.formatCampaign(
      baseCampaign({ budgetUsedPaise: 4000000, poolThresholdBps: 8000 }),
    );
    expect(result.poolPercent).toBe(40);
    expect(result.newClipperIntakeStatus).toBe(NewClipperIntakeStatus.open);
  });

  it("derives closed_at_threshold from live usage even when the stored status is still 'open'", () => {
    // Mirrors the real bug: newClipperIntakeStatus only flips reactively on a
    // view refresh or join attempt, so a campaign whose pool already crossed
    // 80% can still read "open" here between those events. The displayed
    // status must not contradict the displayed poolPercent.
    const service = makeService();
    const result = service.formatCampaign(
      baseCampaign({
        budgetUsedPaise: 8400000,
        poolThresholdBps: 8000,
        newClipperIntakeStatus: NewClipperIntakeStatus.open,
      }),
    );
    expect(result.poolPercent).toBe(84);
    expect(result.newClipperIntakeStatus).toBe(NewClipperIntakeStatus.closed_at_threshold);
  });

  it("does not override an admin's manually_extended status just because usage is high", () => {
    const service = makeService();
    const result = service.formatCampaign(
      baseCampaign({
        budgetUsedPaise: 9500000,
        poolThresholdBps: 8000,
        newClipperIntakeStatus: NewClipperIntakeStatus.manually_extended,
      }),
    );
    expect(result.newClipperIntakeStatus).toBe(NewClipperIntakeStatus.manually_extended);
  });

  it("leaves an already closed_at_threshold status unchanged", () => {
    const service = makeService();
    const result = service.formatCampaign(
      baseCampaign({
        budgetUsedPaise: 9000000,
        poolThresholdBps: 8000,
        newClipperIntakeStatus: NewClipperIntakeStatus.closed_at_threshold,
      }),
    );
    expect(result.newClipperIntakeStatus).toBe(NewClipperIntakeStatus.closed_at_threshold);
  });
});

describe("CampaignsService.notifyCreatorsOfNewCampaign", () => {
  function invoke(service: CampaignsService, campaign: { id: string; title: string }) {
    (service as unknown as { notifyCreatorsOfNewCampaign(c: { id: string; title: string }): void })
      .notifyCreatorsOfNewCampaign(campaign);
  }

  it("notifies only active creators, with push+WhatsApp and a link back to the campaign", async () => {
    const prisma = makePrisma();
    prisma.user.findMany.mockResolvedValue([{ id: "creator-1" }, { id: "creator-2" }]);
    const notifications = makeNotifications();
    const service = makeService(prisma, notifications);

    invoke(service, { id: "camp-1", title: "Summer Drop" });

    await vi.waitFor(() => expect(notifications.create).toHaveBeenCalledTimes(2));

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: UserRole.creator, isActive: true } }),
    );
    expect(notifications.create).toHaveBeenCalledWith(
      "creator-1",
      "creator",
      expect.objectContaining({
        type: "campaign_live",
        link: "/campaigns/camp-1",
        sendWhatsapp: true,
        body: expect.stringContaining("Summer Drop"),
      }),
    );
  });

  it("keeps notifying the rest of the batch when one creator's send fails", async () => {
    const prisma = makePrisma();
    prisma.user.findMany.mockResolvedValue([{ id: "creator-1" }, { id: "creator-2" }]);
    const notifications = makeNotifications();
    notifications.create.mockRejectedValueOnce(new Error("push+whatsapp both down")).mockResolvedValueOnce(undefined);
    const service = makeService(prisma, notifications);

    invoke(service, { id: "camp-1", title: "Summer Drop" });

    await vi.waitFor(() => expect(notifications.create).toHaveBeenCalledTimes(2));
    expect(notifications.create).toHaveBeenNthCalledWith(2, "creator-2", "creator", expect.anything());
  });

  it("never throws synchronously, even if the creator lookup itself fails", () => {
    const prisma = makePrisma();
    prisma.user.findMany.mockRejectedValue(new Error("db down"));
    const service = makeService(prisma, makeNotifications());

    expect(() => invoke(service, { id: "camp-1", title: "Summer Drop" })).not.toThrow();
  });
});
