import { describe, expect, it, vi } from "vitest";

import { InAppNotificationService } from "./in-app-notification.service";

function makeService() {
  const prisma = {
    notification: { create: vi.fn() },
    user: { findMany: vi.fn(), findUnique: vi.fn() },
  };
  const gateway = {
    emitToAdmin: vi.fn(),
    emitToStaff: vi.fn(),
    emitToCreator: vi.fn(),
    emitToBrand: vi.fn(),
  };
  const push = { sendToUser: vi.fn().mockResolvedValue(undefined) };
  const whatsapp = {
    isGeneralTemplateConfigured: vi.fn().mockReturnValue(true),
    sendGeneralUpdate: vi.fn().mockResolvedValue(undefined),
  };
  const service = new InAppNotificationService(prisma as never, gateway as never, push as never, whatsapp as never);
  return { service, prisma, gateway, push, whatsapp };
}

const savedNotification = {
  id: "n1",
  type: "proof_approved",
  title: "Proof approved",
  body: "Payout on the way",
  link: null,
  read: false,
  createdAt: new Date(),
};

describe("InAppNotificationService.create", () => {
  it("always sends push, regardless of sendWhatsapp", async () => {
    const { service, prisma, push } = makeService();
    prisma.notification.create.mockResolvedValue(savedNotification);

    await service.create("user-1", "creator", { type: "x", title: "Hi", body: "There" });

    expect(push.sendToUser).toHaveBeenCalledWith("user-1", { title: "Hi", body: "There", data: undefined });
  });

  it("does not send WhatsApp when sendWhatsapp isn't set — opt-in, not default", async () => {
    const { service, prisma, whatsapp } = makeService();
    prisma.notification.create.mockResolvedValue(savedNotification);
    prisma.user.findUnique.mockResolvedValue({ phone: "+919876543210", displayName: "Ravi", username: null });

    await service.create("user-1", "creator", { type: "x", title: "Hi", body: "There" });

    expect(whatsapp.sendGeneralUpdate).not.toHaveBeenCalled();
  });

  it("sends WhatsApp when sendWhatsapp is set, for a creator with a phone on file", async () => {
    const { service, prisma, whatsapp } = makeService();
    prisma.notification.create.mockResolvedValue(savedNotification);
    prisma.user.findUnique.mockResolvedValue({ phone: "+919876543210", displayName: "Ravi", username: null });

    await service.create("user-1", "creator", { type: "x", title: "Hi", body: "There", sendWhatsapp: true });

    expect(whatsapp.sendGeneralUpdate).toHaveBeenCalledWith("+919876543210", {
      recipientName: "Ravi",
      title: "Hi",
      message: "There",
    });
  });

  it("skips WhatsApp for a non-creator recipient even with sendWhatsapp set", async () => {
    const { service, prisma, whatsapp } = makeService();
    prisma.notification.create.mockResolvedValue(savedNotification);

    await service.create("brand-1", "brand", { type: "x", title: "Hi", body: "There", sendWhatsapp: true });

    expect(whatsapp.sendGeneralUpdate).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("skips WhatsApp when the general template isn't configured", async () => {
    const { service, prisma, whatsapp } = makeService();
    whatsapp.isGeneralTemplateConfigured.mockReturnValue(false);
    prisma.notification.create.mockResolvedValue(savedNotification);

    await service.create("user-1", "creator", { type: "x", title: "Hi", body: "There", sendWhatsapp: true });

    expect(whatsapp.sendGeneralUpdate).not.toHaveBeenCalled();
  });

  it("skips WhatsApp when the creator has no phone on file, without throwing", async () => {
    const { service, prisma, whatsapp } = makeService();
    prisma.notification.create.mockResolvedValue(savedNotification);
    prisma.user.findUnique.mockResolvedValue({ phone: null, displayName: "Ravi", username: null });

    await service.create("user-1", "creator", { type: "x", title: "Hi", body: "There", sendWhatsapp: true });

    expect(whatsapp.sendGeneralUpdate).not.toHaveBeenCalled();
  });

  it("never throws out of create() when the WhatsApp send itself fails", async () => {
    const { service, prisma, whatsapp } = makeService();
    prisma.notification.create.mockResolvedValue(savedNotification);
    prisma.user.findUnique.mockResolvedValue({ phone: "+919876543210", displayName: "Ravi", username: null });
    whatsapp.sendGeneralUpdate.mockRejectedValue(new Error("WhatsApp API down"));

    await expect(
      service.create("user-1", "creator", { type: "x", title: "Hi", body: "There", sendWhatsapp: true }),
    ).resolves.toBeUndefined();
  });

  it("uses whatsappBody instead of body for the WhatsApp send when both are set — the approved template already appends its own CTA", async () => {
    const { service, prisma, whatsapp, push } = makeService();
    prisma.notification.create.mockResolvedValue(savedNotification);
    prisma.user.findUnique.mockResolvedValue({ phone: "+919876543210", displayName: "Ravi", username: null });

    await service.create("user-1", "creator", {
      type: "x",
      title: "Hi",
      body: "There — open the app for details.",
      whatsappBody: "There.",
      sendWhatsapp: true,
    });

    expect(whatsapp.sendGeneralUpdate).toHaveBeenCalledWith("+919876543210", {
      recipientName: "Ravi",
      title: "Hi",
      message: "There.",
    });
    // Push and the stored notification still get the full body, unaffected.
    expect(push.sendToUser).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ body: "There — open the app for details." }),
    );
  });

  it("falls back to the title as the WhatsApp message when there's no body", async () => {
    const { service, prisma, whatsapp } = makeService();
    prisma.notification.create.mockResolvedValue(savedNotification);
    prisma.user.findUnique.mockResolvedValue({ phone: "+919876543210", displayName: null, username: "ravi" });

    await service.create("user-1", "creator", { type: "x", title: "Just a title", sendWhatsapp: true });

    expect(whatsapp.sendGeneralUpdate).toHaveBeenCalledWith("+919876543210", {
      recipientName: "ravi",
      title: "Just a title",
      message: "Just a title",
    });
  });
});
