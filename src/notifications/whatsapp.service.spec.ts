import { afterEach, describe, expect, it, vi } from "vitest";

import { WhatsappService } from "./whatsapp.service";

function makeConfig(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    WHATSAPP_ACCESS_TOKEN: "test-token",
    WHATSAPP_PHONE_NUMBER_ID: "phone-1",
    WHATSAPP_GENERAL_TEMPLATE_NAME: "halchal_creator_update",
    WHATSAPP_GENERAL_TEMPLATE_LANGUAGE: "en",
    WHATSAPP_API_VERSION: "v25.0",
    ...overrides,
  };
  return { get: vi.fn((key: string) => values[key]) };
}

describe("WhatsappService.sendGeneralUpdate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs the returned Meta message id on a successful send", async () => {
    const service = new WhatsappService(makeConfig() as never);
    const logSpy = vi.spyOn(service["logger"], "log");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: "wamid.ABC123" }] }), { status: 200 }),
    );

    await service.sendGeneralUpdate("+919876543210", {
      recipientName: "simba",
      title: "Draft approved",
      message: "Post it live to get paid.",
    });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("wamid.ABC123"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("3210"));
  });

  it("still logs (as 'unknown') rather than throwing when Meta's success response has no message id", async () => {
    const service = new WhatsappService(makeConfig() as never);
    const logSpy = vi.spyOn(service["logger"], "log");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not json", { status: 200 }));

    await expect(
      service.sendGeneralUpdate("+919876543210", { recipientName: "simba", title: "t", message: "m" }),
    ).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("unknown"));
  });

  it("throws (never logs success) when Meta rejects the send", async () => {
    const service = new WhatsappService(makeConfig() as never);
    const logSpy = vi.spyOn(service["logger"], "log");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "template not found" } }), { status: 404 }),
    );

    await expect(
      service.sendGeneralUpdate("+919876543210", { recipientName: "simba", title: "t", message: "m" }),
    ).rejects.toThrow("404");
    expect(logSpy).not.toHaveBeenCalled();
  });
});
