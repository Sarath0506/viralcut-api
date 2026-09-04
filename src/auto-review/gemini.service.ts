import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GoogleGenAI, Type } from "@google/genai";

import type { Env } from "../config/env";
import type { ChecklistItem, CriterionResult } from "./auto-review.types";

const MODEL = "gemini-2.5-flash";

/** Thin wrapper around @google/genai for the auto-review pipeline's Tier 2
 * checks — video/caption compliance against a checklist, checklist
 * derivation from a campaign's free-text brief, and a draft-vs-live visual
 * similarity comparison. Degrades to null/not-configured everywhere rather
 * than throwing, matching ApifyService's existing pattern in this codebase. */
@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private readonly client: GoogleGenAI | null;

  constructor(config: ConfigService<Env, true>) {
    const apiKey = config.get("GEMINI_API_KEY", { infer: true });
    this.client = apiKey ? new GoogleGenAI({ apiKey }) : null;
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  /** Turns a campaign's free-text brief/do's/avoid's into a stable set of
   * individually-checkable criteria, once — callers cache the result on
   * Campaign.complianceChecklist so every deliverable in a campaign is
   * judged against the exact same checklist. */
  async deriveChecklist(input: {
    brief: string;
    doRules: string | null;
    avoidRules: string | null;
  }): Promise<ChecklistItem[] | null> {
    if (!this.client) return null;
    try {
      const parts: string[] = [`BRIEF:\n${input.brief}`];
      if (input.doRules) parts.push(`DO:\n${input.doRules}`);
      if (input.avoidRules) parts.push(`AVOID:\n${input.avoidRules}`);

      const res = await this.client.models.generateContent({
        model: MODEL,
        contents:
          "You turn a brand campaign brief into a short list of individually-checkable " +
          "compliance criteria for reviewing clipper-submitted video content against. " +
          "Each item should be a single, concrete, checkable statement (not vague). " +
          "Cover both the DO and AVOID sections where present. Keep it to 3-8 items.\n\n" +
          parts.join("\n\n"),
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                label: { type: Type.STRING },
                source: { type: Type.STRING, enum: ["brief", "doRules", "avoidRules"] },
              },
              required: ["label", "source"],
            },
          },
        },
      });

      const raw = JSON.parse(res.text ?? "[]") as Array<{ label: string; source: string }>;
      return raw.map((item, i) => ({
        id: `c${i + 1}`,
        label: item.label,
        source: (["brief", "doRules", "avoidRules"] as const).includes(item.source as any)
          ? (item.source as ChecklistItem["source"])
          : "brief",
      }));
    } catch (err) {
      this.logger.warn(`deriveChecklist failed: ${err}`);
      return null;
    }
  }

  /** Evaluates a video (+ caption) against a checklist — per-criterion
   * pass/fail, confidence, and a short reason. Native audio understanding
   * means no separate transcription step: Gemini reasons over whatever
   * speech is actually present, and correctly reports when there isn't any
   * (verified directly against a real silent/music-only test clip). */
  async evaluateCompliance(input: {
    videoBuffer: Buffer;
    caption: string | null;
    checklist: ChecklistItem[];
  }): Promise<CriterionResult[] | null> {
    if (!this.client) return null;
    if (input.checklist.length === 0) return [];
    try {
      const res = await this.client.models.generateContent({
        model: MODEL,
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: "video/mp4", data: input.videoBuffer.toString("base64") } },
              {
                text:
                  "Evaluate this video against each checklist item below. Consider the " +
                  "visuals, any audible speech (transcribe internally as needed — do not " +
                  "assume speech exists, some clips are music-only), and the caption. " +
                  "Content may be in English, Hindi, Telugu, Hinglish, or Tenglish — " +
                  "apply the same scrutiny regardless of language or script. For each " +
                  "item return pass/fail, a confidence from 0 to 1, and a short concrete " +
                  "reason citing what you actually saw/heard.\n\n" +
                  `CAPTION: ${input.caption ?? "(none)"}\n\n` +
                  `CHECKLIST:\n${input.checklist.map((c) => `- [${c.id}] ${c.label}`).join("\n")}`,
              },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                criterionId: { type: Type.STRING },
                label: { type: Type.STRING },
                pass: { type: Type.BOOLEAN },
                confidence: { type: Type.NUMBER },
                reason: { type: Type.STRING },
              },
              required: ["criterionId", "label", "pass", "confidence", "reason"],
            },
          },
        },
      });

      return JSON.parse(res.text ?? "[]") as CriterionResult[];
    } catch (err) {
      this.logger.warn(`evaluateCompliance failed: ${err}`);
      return null;
    }
  }

  /** Weak proxy for "is this the same clip" — compares the draft's video
   * against a static preview image of the live post (all that's fetchable
   * for a live post today; see the plan doc for why this isn't true
   * frame-by-frame or audio comparison). */
  async compareDraftToLive(input: {
    draftVideoBuffer: Buffer;
    liveMediaBuffer: Buffer;
    liveMediaKind: "video" | "image";
  }): Promise<{ same: boolean; confidence: number; reason: string } | null> {
    if (!this.client) return null;
    try {
      const liveMimeType = input.liveMediaKind === "video" ? "video/mp4" : "image/jpeg";
      const liveDescription =
        input.liveMediaKind === "video"
          ? "a video fetched from a live post"
          : "a preview image scraped from a live post (not the full video — a static frame/thumbnail only)";
      const res = await this.client.models.generateContent({
        model: MODEL,
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: "video/mp4", data: input.draftVideoBuffer.toString("base64") } },
              { inlineData: { mimeType: liveMimeType, data: input.liveMediaBuffer.toString("base64") } },
              {
                text:
                  `The first attachment is a video that was originally submitted as a draft. ` +
                  `The second attachment is ${liveDescription} that's claimed to be the same ` +
                  "content, posted later. Does the second attachment look like it's from the " +
                  "same clip (same subject, setting, edit) as the draft? Judge on visual " +
                  "content only if the second attachment is a still image.",
              },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              same: { type: Type.BOOLEAN },
              confidence: { type: Type.NUMBER },
              reason: { type: Type.STRING },
            },
            required: ["same", "confidence", "reason"],
          },
        },
      });

      return JSON.parse(res.text ?? "{}") as { same: boolean; confidence: number; reason: string };
    } catch (err) {
      this.logger.warn(`compareDraftToLivePreview failed: ${err}`);
      return null;
    }
  }
}
