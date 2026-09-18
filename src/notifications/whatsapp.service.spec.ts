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

  it("strips newlines from a multi-line rejection reason before sending — Meta rejects them (error 132018)", async () => {
    // Confirmed live: a real auto-rejection notification failed with
    // "(#132018) ... Param text cannot have new-line/tab characters" —
    // buildAutoRejectionReason joins one line per gate/checklist item with
    // \n, which is exactly this shape.
    const service = new WhatsappService(makeConfig() as never);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: "wamid.X" }] }), { status: 200 }),
    );

    await service.sendGeneralUpdate("+919876543210", {
      recipientName: "simba",
      title: "Proof rejected",
      message: "Automated review — 1 of 4 checks failed:\n✗ doesn't match\n✓ shows the tattoo\n✓ no unrelated content",
    });

    const sentBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const messageParam = sentBody.template.components[0].parameters[1].text as string;
    expect(messageParam).not.toMatch(/[\r\n\t]/);
    expect(messageParam).toContain("doesn't match");
    expect(messageParam).toContain("shows the tattoo");
  });

  it("collapses long runs of spaces — Meta also rejects more than 4 consecutive", async () => {
    const service = new WhatsappService(makeConfig() as never);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: "wamid.X" }] }), { status: 200 }),
    );

    await service.sendGeneralUpdate("+919876543210", {
      recipientName: "simba",
      title: "t",
      message: "too         many spaces",
    });

    const sentBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const messageParam = sentBody.template.components[0].parameters[1].text as string;
    expect(messageParam).not.toMatch(/ {5,}/);
  });
});
