import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CreatorProfilesService } from "./creator-profiles.service";

function makePrisma() {
  return {
    creatorProfile: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
}

describe("CreatorProfilesService", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: CreatorProfilesService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new CreatorProfilesService(prisma as never, {} as never, {} as never);
  });

  describe("create", () => {
    it("makes the first profile the default", async () => {
      prisma.creatorProfile.findUnique.mockResolvedValue(null);
      prisma.creatorProfile.count.mockResolvedValue(0);
      prisma.creatorProfile.create.mockResolvedValue({
        id: "profile-1",
        platform: "instagram",
        handle: "handle1",
        label: null,
        avatarUrl: null,
        isDefault: true,
      });

      const result = await service.create("user-1", {
        platform: "instagram",
        handle: "handle1",
      });

      expect(result.isDefault).toBe(true);
      expect(prisma.creatorProfile.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isDefault: true }) }),
      );
    });

    it("does not default a second profile", async () => {
      prisma.creatorProfile.findUnique.mockResolvedValue(null);
      prisma.creatorProfile.count.mockResolvedValue(1);
      prisma.creatorProfile.create.mockResolvedValue({
        id: "profile-2",
        platform: "youtube",
        handle: "handle2",
        label: null,
        avatarUrl: null,
        isDefault: false,
      });

      const result = await service.create("user-1", {
        platform: "youtube",
        handle: "handle2",
      });

      expect(result.isDefault).toBe(false);
    });

    it("rejects a duplicate platform+handle for the same user", async () => {
      prisma.creatorProfile.findUnique.mockResolvedValue({ id: "existing" });

      await expect(
        service.create("user-1", { platform: "instagram", handle: "handle1" }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe("delete", () => {
    it("blocks deleting a profile with campaign history", async () => {
      prisma.creatorProfile.findFirst.mockResolvedValue({
        id: "profile-1",
        userId: "user-1",
        isDefault: true,
        _count: { participations: 2 },
      });

      await expect(service.delete("user-1", "profile-1")).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.creatorProfile.delete).not.toHaveBeenCalled();
    });

    it("throws not found for a profile owned by someone else", async () => {
      prisma.creatorProfile.findFirst.mockResolvedValue(null);

      await expect(service.delete("user-1", "profile-1")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("promotes another profile to default after deleting the default one", async () => {
      prisma.creatorProfile.findFirst
        .mockResolvedValueOnce({
          id: "profile-1",
          userId: "user-1",
          isDefault: true,
          _count: { participations: 0 },
        })
        .mockResolvedValueOnce({ id: "profile-2" });
      prisma.creatorProfile.delete.mockResolvedValue({});
      prisma.creatorProfile.update.mockResolvedValue({});

      await service.delete("user-1", "profile-1");

      expect(prisma.creatorProfile.delete).toHaveBeenCalledWith({ where: { id: "profile-1" } });
      expect(prisma.creatorProfile.update).toHaveBeenCalledWith({
        where: { id: "profile-2" },
        data: { isDefault: true },
      });
    });
  });

  describe("assertOwnership", () => {
    it("throws not found when the profile isn't the user's", async () => {
      prisma.creatorProfile.findFirst.mockResolvedValue(null);

      await expect(
        service.assertOwnership("user-1", "someone-elses-profile"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("returns the profile when owned by the user", async () => {
      const profile = { id: "profile-1", userId: "user-1" };
      prisma.creatorProfile.findFirst.mockResolvedValue(profile);

      await expect(service.assertOwnership("user-1", "profile-1")).resolves.toBe(profile);
    });
  });
});
