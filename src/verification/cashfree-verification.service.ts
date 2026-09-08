import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { Env } from "../config/env";

export type PanVerificationResult =
  | { valid: true; registeredName: string; nameMatchResult: string; panStatus: string }
  | { valid: false; reason: string };

export type AadhaarVerificationResult =
  | {
      valid: true;
      name: string | null;
      dob: string | null;
      gender: string | null;
      maskedNumber: string | null;
      qrVerified: boolean;
    }
  | { valid: false; reason: string };

export type PanOcrVerificationResult =
  | {
      valid: true;
      panNumber: string | null;
      name: string | null;
      dob: string | null;
      panStatus: string | null;
    }
  | { valid: false; reason: string };

type CashfreeOcrResponse = {
  status?: string;
  message?: string;
  document_fields?: { uid?: string; name?: string; dob?: string; gender?: string; pan?: string; father?: string };
  fraud_checks?: Record<string, boolean | null>;
  qr_details?: { status?: string };
  verification_details?: { status?: string; name_match?: string; pan_status?: string };
};

/** Cashfree's OCR endpoint needs a real image extension on the multipart
 * filename to recognize the upload at all — a filename with no extension
 * (e.g. "pan-front") gets rejected outright with "Provide valid file or
 * file url", confirmed via a live call, even though the file bytes and
 * content-type were both correct. */
function extensionFor(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "application/pdf") return "pdf";
  return "jpg";
}

const REQUEST_TIMEOUT_MS = 20_000;
// Cashfree expects a date-stamped API version header — bumping this needs a
// deliberate check against their changelog, not a silent auto-latest.
const API_VERSION = "2024-12-01";

/** Thin wrapper around Cashfree's Secure ID (Verification Suite) APIs —
 * real PAN lookup against NSDL/Income Tax records, and Aadhaar OCR + QR
 * verification against UIDAI-sourced data, for the clipper signup
 * verification gate. Secure ID is a separate product from Cashfree
 * Payments; having one doesn't mean the other is active on the same
 * account — see CASHFREE_CLIENT_ID's config comment. Degrades to
 * not-configured (null) rather than throwing, matching this codebase's
 * existing pattern for optional third-party integrations
 * (ApifyService/GeminiService). Sandbox responses are mocked by Cashfree
 * itself, not real lookups — see CASHFREE_ENV. */
@Injectable()
export class CashfreeVerificationService {
  private readonly logger = new Logger(CashfreeVerificationService.name);
  private readonly clientId: string | null;
  private readonly clientSecret: string | null;
  private readonly baseUrl: string;

  constructor(config: ConfigService<Env, true>) {
    this.clientId = config.get("CASHFREE_CLIENT_ID", { infer: true }) ?? null;
    this.clientSecret = config.get("CASHFREE_CLIENT_SECRET", { infer: true }) ?? null;
    this.baseUrl =
      config.get("CASHFREE_ENV", { infer: true }) === "production"
        ? "https://api.cashfree.com"
        : "https://sandbox.cashfree.com";
  }

  get isConfigured(): boolean {
    return !!this.clientId && !!this.clientSecret;
  }

  private headers(): Record<string, string> {
    return {
      "x-client-id": this.clientId!,
      "x-client-secret": this.clientSecret!,
      "x-api-version": API_VERSION,
    };
  }

  /** Verifies a PAN number against NSDL/Income Tax records — real-time,
   * synchronous, single call. `name` is what the clipper claims as their
   * own name; Cashfree returns how well it matches the PAN's actual
   * registered name (name_match_result) — without it, this can only
   * confirm the PAN itself is real/active, not that it belongs to this
   * specific person. */
  async verifyPan(pan: string, name: string): Promise<PanVerificationResult | null> {
    if (!this.isConfigured) return null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const res = await fetch(`${this.baseUrl}/verification/pan`, {
        method: "POST",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ pan, name }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok || !data) {
        this.logger.warn(`PAN verification request failed: HTTP ${res.status}`);
        return {
          valid: false,
          reason: typeof data?.message === "string" ? data.message : `Request failed (${res.status})`,
        };
      }
      if (data.valid !== true) {
        const reason =
          (typeof data.pan_status_desc === "string" && data.pan_status_desc) ||
          (typeof data.message === "string" && data.message) ||
          "PAN could not be verified";
        return { valid: false, reason };
      }
      return {
        valid: true,
        registeredName: typeof data.registered_name === "string" ? data.registered_name : "",
        nameMatchResult: typeof data.name_match_result === "string" ? data.name_match_result : "UNKNOWN",
        panStatus: typeof data.pan_status === "string" ? data.pan_status : "UNKNOWN",
      };
    } catch (err) {
      this.logger.warn(`PAN verification error: ${err}`);
      return null;
    }
  }

  /** Runs Cashfree's Smart OCR against an uploaded PAN card photo, with
   * do_verification requesting the real-time ITD (Income Tax Dept) lookup
   * in the same call rather than a raw OCR text read. Fails closed on
   * Cashfree's own fraud signals, an unreadable document, or a real-time
   * status other than VALID. Note the tradeoff versus the old text+name
   * flow this replaces: `name_match` here compares the OCR-read name
   * against the PAN's *own* ITD-registered name (catches an altered/fake
   * card), not against this app's user record — so a clean result proves
   * the card is genuine, not that it's the uploader's own card. */
  async verifyPanByOcr(
    imageBuffer: Buffer,
    mimeType: string,
    verificationId: string,
  ): Promise<PanOcrVerificationResult | null> {
    if (!this.isConfigured) return null;
    try {
      const form = new FormData();
      form.append("verification_id", verificationId);
      form.append("document_type", "PAN");
      form.append("do_verification", "true");
      form.append("file", new Blob([imageBuffer], { type: mimeType }), `pan-front.${extensionFor(mimeType)}`);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const res = await fetch(`${this.baseUrl}/verification/bharat-ocr`, {
        method: "POST",
        headers: this.headers(),
        body: form,
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      const data = (await res.json().catch(() => null)) as CashfreeOcrResponse | null;
      if (!res.ok || !data) {
        const detail = typeof data?.message === "string" ? data.message : `HTTP ${res.status}`;
        this.logger.warn(`PAN OCR verification request failed: ${detail}`);
        return { valid: false, reason: `Request failed: ${detail}` };
      }

      const fraud = data.fraud_checks ?? {};
      const failedFraudChecks = Object.entries(fraud)
        .filter(([, flagged]) => flagged === true)
        .map(([check]) => check);
      if (failedFraudChecks.length > 0) {
        this.logger.warn(`PAN OCR verification ${verificationId} flagged: ${failedFraudChecks.join(", ")}`);
        return { valid: false, reason: `Failed fraud checks: ${failedFraudChecks.join(", ")}` };
      }
      if (data.status !== "VALID") {
        return { valid: false, reason: "Document could not be read or verified" };
      }
      if (data.verification_details?.status !== "VALID") {
        return { valid: false, reason: "PAN could not be verified against government records" };
      }
      if (data.verification_details?.name_match === "N") {
        return { valid: false, reason: "The name on this PAN doesn't match its registered records" };
      }

      return {
        valid: true,
        panNumber: data.document_fields?.pan ?? null,
        name: data.document_fields?.name ?? null,
        dob: data.document_fields?.dob ?? null,
        panStatus: data.verification_details?.pan_status ?? null,
      };
    } catch (err) {
      this.logger.warn(`PAN OCR verification error for ${verificationId}: ${err}`);
      return null;
    }
  }

  /** Runs Cashfree's Smart OCR (+ QR, since do_verification requests the
   * strongest real-time check, not just a raw OCR text read) against an
   * uploaded Aadhaar front-image. Fails closed on any of Cashfree's own
   * fraud signals (forged, screenshot, photo of a screen, overwritten,
   * imposed) — those are purpose-built fraud detectors on their end, not
   * a judgment call for this method to second-guess. `verificationId`
   * must be unique per request (Cashfree's own requirement) — pass
   * something like the user's id + a fresh random suffix, never reused
   * across retries of the same logical submission. */
  async verifyAadhaar(
    imageBuffer: Buffer,
    mimeType: string,
    verificationId: string,
  ): Promise<AadhaarVerificationResult | null> {
    if (!this.isConfigured) return null;
    try {
      const form = new FormData();
      form.append("verification_id", verificationId);
      form.append("document_type", "AADHAAR");
      form.append("do_verification", "true");
      form.append("file", new Blob([imageBuffer], { type: mimeType }), `aadhaar-front.${extensionFor(mimeType)}`);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const res = await fetch(`${this.baseUrl}/verification/bharat-ocr`, {
        method: "POST",
        headers: this.headers(),
        body: form,
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      const data = (await res.json().catch(() => null)) as CashfreeOcrResponse | null;
      if (!res.ok || !data) {
        const detail = typeof data?.message === "string" ? data.message : `HTTP ${res.status}`;
        this.logger.warn(`Aadhaar verification request failed: ${detail}`);
        return { valid: false, reason: `Request failed: ${detail}` };
      }

      const fraud = data.fraud_checks ?? {};
      const failedFraudChecks = Object.entries(fraud)
        .filter(([, flagged]) => flagged === true)
        .map(([check]) => check);
      if (failedFraudChecks.length > 0) {
        this.logger.warn(`Aadhaar verification ${verificationId} flagged: ${failedFraudChecks.join(", ")}`);
        return { valid: false, reason: `Failed fraud checks: ${failedFraudChecks.join(", ")}` };
      }
      if (data.status !== "VALID") {
        return { valid: false, reason: "Document could not be read or verified" };
      }

      return {
        valid: true,
        name: data.document_fields?.name ?? null,
        dob: data.document_fields?.dob ?? null,
        gender: data.document_fields?.gender ?? null,
        maskedNumber: data.document_fields?.uid ?? null,
        qrVerified: data.qr_details?.status === "SECURE",
      };
    } catch (err) {
      this.logger.warn(`Aadhaar verification error for ${verificationId}: ${err}`);
      return null;
    }
  }
}
