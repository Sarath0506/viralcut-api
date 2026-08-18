import { describe, expect, it, vi, beforeEach } from "vitest";

const sendEachForMulticast = vi.fn();
const initializeApp = vi.fn(() => ({ name: "push-notifications" }));
const deleteApp = vi.fn();
const cert = vi.fn((v: unknown) => v);

vi.mock("firebase-admin/app", () => ({
  initializeApp: (...args: unknown[]) => initializeApp(...args),
  deleteApp: (...args: unknown[]) => deleteApp(...args),
  cert: (...args: unknown[]) => cert(...args),
}));

vi.mock("firebase-admin/messaging", () => ({
  getMessaging: () => ({ sendEachForMulticast }),
}));

import { PushNotificationService } from "./push-notification.service";

function makeService(serviceAccountBase64: string | undefined) {
  const config = { get: vi.fn().mockReturnValue(serviceAccountBase64) };
  const prisma = {
    deviceToken: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
  const service = new PushNotificationService(config as never, prisma as never);
  return { service, config, prisma };
}

const validServiceAccount = Buffer.from(
  JSON.stringify({ project_id: "halchal-5108a", client_email: "x@y.iam.gserviceaccount.com", private_key: "x" }),
).toString("base64");

describe("PushNotificationService", () => {
  beforeEach(() => {
    sendEachForMulticast.mockReset();
    initializeApp.mockClear();
    deleteApp.mockClear();
  });

  it("reports not configured when FIREBASE_SERVICE_ACCOUNT_BASE64 is unset", () => {
    const { service } = makeService(undefined);
    expect(service.isConfigured()).toBe(false);
  });

  it("reports not configured when the base64 payload isn't valid JSON", () => {
    const { service } = makeService("not-valid-base64-json");
    expect(service.isConfigured()).toBe(false);
  });

  it("sendToUserWithResult reports not-configured without touching the DB", async () => {
    const { service, prisma } = makeService(undefined);
    const result = await service.sendToUserWithResult("user-1", { title: "Hi" });
    expect(result).toEqual({ delivered: false, reason: "Push not configured" });
    expect(prisma.deviceToken.findMany).not.toHaveBeenCalled();
  });

  it("reports no registered device when the user has no tokens", async () => {
    const { service, prisma } = makeService(validServiceAccount);
    prisma.deviceToken.findMany.mockResolvedValue([]);
    const result = await service.sendToUserWithResult("user-1", { title: "Hi" });
    expect(result).toEqual({ delivered: false, reason: "No registered device" });
  });

  it("delivers and reports success when at least one token succeeds", async () => {
    const { service, prisma } = makeService(validServiceAccount);
    prisma.deviceToken.findMany.mockResolvedValue([
      { token: "tok-1", platform: "ios" },
      { token: "tok-2", platform: "android" },
    ]);
    sendEachForMulticast.mockResolvedValue({
      successCount: 1,
      responses: [{ success: true }, { success: false, error: { code: "messaging/internal-error" } }],
    });

    const result = await service.sendToUserWithResult("user-1", { title: "Hi" });
    expect(result).toEqual({ delivered: true });
    // A transient error code shouldn't cause the token to be dropped.
    expect(prisma.deviceToken.deleteMany).not.toHaveBeenCalled();
  });

  it("drops dead tokens (unregistered/invalid) but keeps tokens with transient errors", async () => {
    const { service, prisma } = makeService(validServiceAccount);
    prisma.deviceToken.findMany.mockResolvedValue([
      { token: "dead-tok", platform: "ios" },
      { token: "live-tok", platform: "android" },
    ]);
    sendEachForMulticast.mockResolvedValue({
      successCount: 0,
      responses: [
        { success: false, error: { code: "messaging/registration-token-not-registered" } },
        { success: false, error: { code: "messaging/server-unavailable" } },
      ],
    });

    const result = await service.sendToUserWithResult("user-1", { title: "Hi" });
    expect(result).toEqual({ delivered: false, reason: "Delivery failed for all devices" });
    expect(prisma.deviceToken.deleteMany).toHaveBeenCalledWith({
      where: { token: { in: ["dead-tok"] } },
    });
  });
});
