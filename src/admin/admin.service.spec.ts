import { BadRequestException, NotFoundException } from "@nestjs/common";
import { NewClipperIntakeStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { AdminService } from "./admin.service";

function makeService() {
  const prisma = {
    campaign: { update: vi.fn() },
    brandProfile: { findUnique: vi.fn(), update: vi.fn() },
    user: { update: vi.fn() },
    refreshToken: { updateMany: vi.fn() },
    $transaction: vi.fn().mockResolvedValue([]),
    $queryRaw: vi.fn().mockResolvedValue([{ total: 0n }]),
  };
  const realtime = { emitCampaignUpdated: vi.fn() };
  const service = new AdminService(
    prisma as never,
    {} as never, // campaigns
    {} as never, // email
    {} as never, // wallet
    {} as never, // activityLog
    {} as never, // notifications
    realtime as never,
    {} as never, // support
    {} as never, // bulkNotifications
    {} as never, // faqs
    {} as never, // adminRoles
  );
  return { service, prisma, realtime };
}

describe("AdminService.setCampaignClipperIntake", () => {
  it("sets manually_extended with the given allowance when > 0", async () => {
    const { service, prisma, realtime } = makeService();
    prisma.campaign.update.mockResolvedValue({
      id: "camp-1",
      brandProfileId: "brand-1",
      budgetPaise: 1_000_000,
      newClipperIntakeStatus: NewClipperIntakeStatus.manually_extended,
      extraClipperAllowance: 5,
    });

    const result = await service.setCampaignClipperIntake("camp-1", 5);

    expect(prisma.campaign.update).toHaveBeenCalledWith({
      where: { id: "camp-1" },
      data: { extraClipperAllowance: 5, newClipperIntakeStatus: NewClipperIntakeStatus.manually_extended },
    });
    expect(result.newClipperIntakeStatus).toBe(NewClipperIntakeStatus.manually_extended);
    expect(realtime.emitCampaignUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ id: "camp-1", newClipperIntakeStatus: NewClipperIntakeStatus.manually_extended }),
    );
  });

  it("sets closed_at_threshold when the allowance is set to 0", async () => {
    const { service, prisma } = makeService();
    prisma.campaign.update.mockResolvedValue({
      id: "camp-1",
      brandProfileId: "brand-1",
      budgetPaise: 1_000_000,
      newClipperIntakeStatus: NewClipperIntakeStatus.closed_at_threshold,
      extraClipperAllowance: 0,
    });

    await service.setCampaignClipperIntake("camp-1", 0);

    expect(prisma.campaign.update).toHaveBeenCalledWith({
      where: { id: "camp-1" },
      data: { extraClipperAllowance: 0, newClipperIntakeStatus: NewClipperIntakeStatus.closed_at_threshold },
    });
  });

  it("throws NotFoundException for an unknown campaign", async () => {
    const { service, prisma } = makeService();
    prisma.campaign.update.mockRejectedValue({ code: "P2025" });

    await expect(service.setCampaignClipperIntake("missing", 5)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe("AdminService.setCampaignPoolOverflow", () => {
  it("toggles allowExcessViewsToFillPool and emits the update", async () => {
    const { service, prisma, realtime } = makeService();
    prisma.campaign.update.mockResolvedValue({
      id: "camp-1",
      brandProfileId: "brand-1",
      budgetPaise: 1_000_000,
      allowExcessViewsToFillPool: true,
    });

    const result = await service.setCampaignPoolOverflow("camp-1", true);

    expect(prisma.campaign.update).toHaveBeenCalledWith({
      where: { id: "camp-1" },
      data: { allowExcessViewsToFillPool: true },
    });
    expect(result.allowExcessViewsToFillPool).toBe(true);
    expect(realtime.emitCampaignUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ id: "camp-1", allowExcessViewsToFillPool: true }),
    );
  });
});

describe("AdminService.deleteBrand", () => {
  it("throws NotFoundException for an unknown brand", async () => {
    const { service, prisma } = makeService();
    prisma.brandProfile.findUnique.mockResolvedValue(null);

    await expect(service.deleteBrand("missing")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("blocks deletion when the brand has existing campaigns", async () => {
    const { service, prisma } = makeService();
    prisma.brandProfile.findUnique.mockResolvedValue({
      id: "brand-1",
      userId: "user-1",
      _count: { campaigns: 1 },
    });

    await expect(service.deleteBrand("brand-1")).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("soft-deletes and scrubs PII when the brand has no campaigns", async () => {
    const { service, prisma } = makeService();
    prisma.brandProfile.findUnique.mockResolvedValue({
      id: "brand-1",
      userId: "user-1",
      _count: { campaigns: 0 },
    });

    const result = await service.deleteBrand("brand-1");

    expect(result).toEqual({ deleted: true });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: expect.objectContaining({ isActive: false, email: null, phone: null }),
    });
    expect(prisma.brandProfile.update).toHaveBeenCalledWith({
      where: { id: "brand-1" },
      data: expect.objectContaining({ companyName: "Deleted brand", companyEmail: null }),
    });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
