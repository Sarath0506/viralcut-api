import { afterEach, describe, expect, it, vi } from "vitest";

import { CashfreeVerificationService } from "./cashfree-verification.service";

function makeConfig(configured: boolean) {
  const values: Record<string, string> = configured
    ? { CASHFREE_CLIENT_ID: "test-client-id", CASHFREE_CLIENT_SECRET: "test-secret", CASHFREE_ENV: "sandbox" }
    : { CASHFREE_ENV: "sandbox" };
  return { get: vi.fn((key: string) => values[key]) };
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe("CashfreeVerificationService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("isConfigured", () => {
    it("is false with no credentials, true with both set", () => {
      expect(new CashfreeVerificationService(makeConfig(false) as never).isConfigured).toBe(false);
      expect(new CashfreeVerificationService(makeConfig(true) as never).isConfigured).toBe(true);
    });
  });

  describe("verifyPan", () => {
    it("returns null without calling fetch when not configured", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const service = new CashfreeVerificationService(makeConfig(false) as never);

      const result = await service.verifyPan("ABCPV1234D", "Test User");

      expect(result).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns a verified result on a genuine PAN match", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse({
          valid: true,
          registered_name: "TEST USER",
          name_match_result: "DIRECT_MATCH",
          pan_status: "VALID",
        }),
      );
      const service = new CashfreeVerificationService(makeConfig(true) as never);

      const result = await service.verifyPan("ABCPV1234D", "Test User");

      expect(result).toEqual({
        valid: true,
        registeredName: "TEST USER",
        nameMatchResult: "DIRECT_MATCH",
        panStatus: "VALID",
      });
    });

    it("returns valid: false with a reason when Cashfree rejects the PAN", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse({ valid: false, pan_status: "INVALID", pan_status_desc: "PAN not found" }),
      );
      const service = new CashfreeVerificationService(makeConfig(true) as never);

      const result = await service.verifyPan("ZZZZZ9999Z", "Nobody");

      expect(result).toEqual({ valid: false, reason: "PAN not found" });
    });

    it("returns null (not a rejection) on a network error — an unresolved attempt, not a real fail", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
      const service = new CashfreeVerificationService(makeConfig(true) as never);

      const result = await service.verifyPan("ABCPV1234D", "Test User");

      expect(result).toBeNull();
    });

    it("sends the real client-id/client-secret headers and the pan+name body", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(jsonResponse({ valid: true, registered_name: "X", pan_status: "VALID" }));
      const service = new CashfreeVerificationService(makeConfig(true) as never);

      await service.verifyPan("ABCPV1234D", "Test User");

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://sandbox.cashfree.com/verification/pan",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "x-client-id": "test-client-id",
            "x-client-secret": "test-secret",
          }),
          body: JSON.stringify({ pan: "ABCPV1234D", name: "Test User" }),
        }),
      );
    });
  });

  describe("verifyPanByOcr", () => {
    const buffer = Buffer.from("fake-pan-bytes");

    it("returns null without calling fetch when not configured", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const service = new CashfreeVerificationService(makeConfig(false) as never);

      const result = await service.verifyPanByOcr(buffer, "image/jpeg", "user-1-abc");

      expect(result).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns a verified result with mapped fields on a clean, government-matched PAN", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse({
          status: "VALID",
          document_fields: { pan: "ABCPV1234D", name: "Test User", dob: "1990-01-01" },
          fraud_checks: { is_forged: false, is_screenshot: false },
          verification_details: { status: "VALID", name_match: "Y", pan_status: "VALID" },
        }),
      );
      const service = new CashfreeVerificationService(makeConfig(true) as never);

      const result = await service.verifyPanByOcr(buffer, "image/jpeg", "user-1-abc");

      expect(result).toEqual({
        valid: true,
        panNumber: "ABCPV1234D",
        name: "Test User",
        dob: "1990-01-01",
        panStatus: "VALID",
      });
    });

    it("fails closed when Cashfree's own fraud checks flag the document", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse({
          status: "VALID",
          document_fields: { pan: "ABCPV1234D", name: "Test User" },
          fraud_checks: { is_forged: true },
          verification_details: { status: "VALID", name_match: "Y" },
        }),
      );
      const service = new CashfreeVerificationService(makeConfig(true) as never);

      const result = await service.verifyPanByOcr(buffer, "image/jpeg", "user-1-abc");

      expect(result).toEqual({ valid: false, reason: "Failed fraud checks: is_forged" });
    });

    it("rejects when the real-time government check doesn't come back VALID", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse({
          status: "VALID",
          document_fields: { pan: "ABCPV1234D", name: "Test User" },
          fraud_checks: {},
          verification_details: { status: "INVALID" },
        }),
      );
      const service = new CashfreeVerificationService(makeConfig(true) as never);

      const result = await service.verifyPanByOcr(buffer, "image/jpeg", "user-1-abc");

      expect(result).toEqual({ valid: false, reason: "PAN could not be verified against government records" });
    });

    it("rejects when the printed name doesn't match the PAN's own registered name", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse({
          status: "VALID",
          document_fields: { pan: "ABCPV1234D", name: "Someone Else" },
          fraud_checks: {},
          verification_details: { status: "VALID", name_match: "N" },
        }),
      );
      const service = new CashfreeVerificationService(makeConfig(true) as never);

      const result = await service.verifyPanByOcr(buffer, "image/jpeg", "user-1-abc");

      expect(result).toEqual({
        valid: false,
        reason: "The name on this PAN doesn't match its registered records",
      });
    });

    it("returns null (not a rejection) on a network error", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
      const service = new CashfreeVerificationService(makeConfig(true) as never);

      const result = await service.verifyPanByOcr(buffer, "image/jpeg", "user-1-abc");

      expect(result).toBeNull();
    });

    it("sends verification_id, document_type PAN, do_verification and the file as multipart form data", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse({
          status: "VALID",
          document_fields: {},
          fraud_checks: {},
          verification_details: { status: "VALID", name_match: "Y" },
        }),
      );
      const service = new CashfreeVerificationService(makeConfig(true) as never);

      await service.verifyPanByOcr(buffer, "image/jpeg", "user-1-abc");

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://sandbox.cashfree.com/verification/bharat-ocr",
        expect.objectContaining({ method: "POST" }),
      );
      const call = fetchSpy.mock.calls[0][1] as RequestInit;
      const form = call.body as FormData;
      expect(form.get("verification_id")).toBe("user-1-abc");
      expect(form.get("document_type")).toBe("PAN");
      expect(form.get("do_verification")).toBe("true");
      expect(form.get("file")).toBeInstanceOf(Blob);
    });
  });

  describe("verifyAadhaar", () => {
    const buffer = Buffer.from("fake-image-bytes");

    it("returns null without calling fetch when not configured", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const service = new CashfreeVerificationService(makeConfig(false) as never);

      const result = await service.verifyAadhaar(buffer, "image/jpeg", "user-1-abc");

      expect(result).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns a verified result with mapped fields on a clean, valid document", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse({
          status: "VALID",
          document_fields: { uid: "XXXXXXXX1234", name: "Test User", dob: "1990-01-01", gender: "Male" },
          fraud_checks: { is_forged: false, is_screenshot: false },
          qr_details: { status: "SECURE" },
        }),
      );
      const service = new CashfreeVerificationService(makeConfig(true) as never);

      const result = await service.verifyAadhaar(buffer, "image/jpeg", "user-1-abc");

      expect(result).toEqual({
        valid: true,
        name: "Test User",
        dob: "1990-01-01",
        gender: "Male",
        maskedNumber: "XXXXXXXX1234",
        qrVerified: true,
      });
    });

    it("fails closed when Cashfree's own fraud checks flag the document, even if status is VALID", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse({
          status: "VALID",
          document_fields: { uid: "XXXXXXXX1234", name: "Test User" },
          fraud_checks: { is_forged: false, is_photo_of_screen: true },
          qr_details: { status: "SECURE" },
        }),
      );
      const service = new CashfreeVerificationService(makeConfig(true) as never);

      const result = await service.verifyAadhaar(buffer, "image/jpeg", "user-1-abc");

      expect(result).toEqual({ valid: false, reason: "Failed fraud checks: is_photo_of_screen" });
    });

    it("returns valid: false when the document status itself isn't VALID", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse({
          status: "INVALID",
          document_fields: {},
          fraud_checks: {},
          qr_details: { status: "NOT_PRESENT" },
        }),
      );
      const service = new CashfreeVerificationService(makeConfig(true) as never);

      const result = await service.verifyAadhaar(buffer, "image/jpeg", "user-1-abc");

      expect(result).toEqual({ valid: false, reason: "Document could not be read or verified" });
    });

    it("returns null (not a rejection) on a network error", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
      const service = new CashfreeVerificationService(makeConfig(true) as never);

      const result = await service.verifyAadhaar(buffer, "image/jpeg", "user-1-abc");

      expect(result).toBeNull();
    });

    it("sends verification_id, document_type, do_verification and the file as multipart form data", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse({ status: "VALID", document_fields: {}, fraud_checks: {}, qr_details: {} }),
      );
      const service = new CashfreeVerificationService(makeConfig(true) as never);

      await service.verifyAadhaar(buffer, "image/jpeg", "user-1-abc");

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://sandbox.cashfree.com/verification/bharat-ocr",
        expect.objectContaining({ method: "POST" }),
      );
      const call = fetchSpy.mock.calls[0][1] as RequestInit;
      const form = call.body as FormData;
      expect(form.get("verification_id")).toBe("user-1-abc");
      expect(form.get("document_type")).toBe("AADHAAR");
      expect(form.get("do_verification")).toBe("true");
      expect(form.get("file")).toBeInstanceOf(Blob);
    });
  });

  describe("CASHFREE_ENV", () => {
    it("uses the production base URL when CASHFREE_ENV is 'production'", async () => {
      const config = {
        get: vi.fn((key: string) =>
          ({
            CASHFREE_CLIENT_ID: "id",
            CASHFREE_CLIENT_SECRET: "secret",
            CASHFREE_ENV: "production",
          })[key],
        ),
      };
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(jsonResponse({ valid: true, registered_name: "X", pan_status: "VALID" }));
      const service = new CashfreeVerificationService(config as never);

      await service.verifyPan("ABCPV1234D", "Test User");

      expect(fetchSpy).toHaveBeenCalledWith("https://api.cashfree.com/verification/pan", expect.anything());
    });
  });
});
