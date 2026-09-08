import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GoogleGenAI, Type } from "@google/genai";

import type { Env } from "../config/env";
import type { ChecklistItem, CriterionResult } from "./auto-review.types";

const MODEL = "gemini-2.5-flash";
// A call that never resolves would otherwise hang the whole fire-and-forget
// pipeline indefinitely — confirmed live with a large inline video payload
// that never completed. This doesn't cancel the in-flight request, just
// stops waiting on it, so the pipeline can still log needs_review instead
// of hanging forever.
const GENERATE_CONTENT_TIMEOUT_MS = 60_000;

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

  private withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${GENERATE_CONTENT_TIMEOUT_MS}ms`)),
        GENERATE_CONTENT_TIMEOUT_MS,
      );
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
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

      const res = await this.withTimeout(this.client.models.generateContent({
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
      }), "deriveChecklist");

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
   * (verified directly against a real silent/music-only test clip).
   *
   * The checklist is fully assembled by the caller (AutoReviewService) —
   * this method doesn't decide what's required. When it already contains a
   * source_video_match and/or source_audio_match item (added only when the
   * campaign's corresponding requirement isn't "not_required"), sourceMedia
   * is sent as an extra attachment and the prompt explains how to judge
   * whichever of those two items is actually present: video-match on
   * visuals only, audio-match on the audio track only — a song-push
   * campaign can require the audio without caring what footage is used.
   * sourceMedia can be bytes already fetched (an uploaded/Drive Source
   * Asset) or a YouTube URL — Gemini fetches and processes a YouTube video
   * directly server-side when given as fileData.fileUri, verified live
   * against a real public video, so a YouTube-link source asset doesn't
   * need to be downloaded by us at all. Each returned result is enriched
   * with `required`, copied from the matching checklist item, so the
   * caller's decision logic knows which fails actually gate the outcome. */
  async evaluateCompliance(input: {
    videoBuffer: Buffer;
    mimeType: string;
    caption: string | null;
    checklist: ChecklistItem[];
    sourceMedia?: { buffer: Buffer; mimeType: string } | { youtubeUrl: string } | null;
  }): Promise<CriterionResult[] | null> {
    if (!this.client) return null;
    const checklist = input.checklist;
    if (checklist.length === 0) return [];
    const hasVideoMatchItem = checklist.some((c) => c.id === "source_video_match");
    const hasAudioMatchItem = checklist.some((c) => c.id === "source_audio_match");
    try {
      const isImage = input.mimeType.startsWith("image/");
      const parts: Array<
        | { inlineData: { mimeType: string; data: string } }
        | { fileData: { fileUri: string } }
        | { text: string }
      > = [];
      if (input.sourceMedia && "youtubeUrl" in input.sourceMedia) {
        parts.push({ fileData: { fileUri: input.sourceMedia.youtubeUrl } });
      } else if (input.sourceMedia) {
        parts.push({
          inlineData: {
            mimeType: input.sourceMedia.mimeType,
            data: input.sourceMedia.buffer.toString("base64"),
          },
        });
      }
      parts.push({ inlineData: { mimeType: input.mimeType, data: input.videoBuffer.toString("base64") } });

      const matchJudgments: string[] = [];
      if (hasVideoMatchItem) {
        matchJudgments.push(
          "For the source_video_match item, judge whether the clip is PREDOMINANTLY derived from " +
            "the source attachment's footage. Color grading, filters, transitions, reordering the " +
            "source segments, text overlays, and a reasonable amount of B-roll/cutaways are normal " +
            "editing and should NOT cause a fail by themselves — a clip can pass this item even with " +
            "some added footage mixed in, as long as most of it is clearly the source content, edited. " +
            "Fail this item only when a substantial portion of the clip is visually unrelated content " +
            "that doesn't derive from the source at all (a genuinely different subject/scene, not just " +
            "a different edit of the same one).",
        );
      }
      if (hasAudioMatchItem) {
        matchJudgments.push(
          "For the source_audio_match item, judge whether the submitted clip's AUDIO TRACK (the " +
            "music/song playing, not any spoken voiceover) matches the audio in the source attachment — " +
            "the visuals don't matter for this item, only whether it's the same audio/song.",
        );
      }

      parts.push({
        text:
          (input.sourceMedia
            ? "The FIRST attachment is the brand's original source material. The " +
              `SECOND attachment is the submitted ${isImage ? "image" : "clip"}. ` +
              `${matchJudgments.join(" ")} For every other item, judge the submitted clip itself.\n\n`
            : `Evaluate this ${isImage ? "image" : "video"} against each checklist item below.\n\n`) +
          "Consider the visuals" +
          (isImage
            ? ""
            : ", any audible speech (transcribe internally as needed — do not " +
              "assume speech exists, some clips are music-only)") +
          ", and the caption. " +
          "Content may be in English, Hindi, Telugu, Hinglish, or Tenglish — " +
          "apply the same scrutiny regardless of language or script. For each " +
          "item return pass/fail, a confidence from 0 to 1, and a short concrete " +
          "reason citing what you actually saw/heard.\n\n" +
          `CAPTION: ${input.caption ?? "(none)"}\n\n` +
          `CHECKLIST:\n${checklist.map((c) => `- [${c.id}] ${c.label}`).join("\n")}`,
      });

      const res = await this.withTimeout(this.client.models.generateContent({
        model: MODEL,
        contents: [{ role: "user", parts }],
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
      }), "evaluateCompliance");

      const raw = JSON.parse(res.text ?? "[]") as Array<{
        criterionId: string;
        label: string;
        pass: boolean;
        confidence: number;
        reason: string;
      }>;
      return raw.map((r) => ({
        ...r,
        required: checklist.find((c) => c.id === r.criterionId)?.required ?? true,
      }));
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
    draftMediaBuffer: Buffer;
    draftMimeType: string;
    liveMediaBuffer: Buffer;
    liveMediaKind: "video" | "image";
  }): Promise<{ same: boolean; confidence: number; reason: string } | null> {
    if (!this.client) return null;
    try {
      const liveMimeType = input.liveMediaKind === "video" ? "video/mp4" : "image/jpeg";
      const draftDescription = input.draftMimeType.startsWith("image/")
        ? "an image that was originally submitted as a draft"
        : "a video that was originally submitted as a draft";
      const liveDescription =
        input.liveMediaKind === "video"
          ? "a video fetched from a live post"
          : "a preview image scraped from a live post (not the full video — a static frame/thumbnail only)";
      const res = await this.withTimeout(this.client.models.generateContent({
        model: MODEL,
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: input.draftMimeType, data: input.draftMediaBuffer.toString("base64") } },
              { inlineData: { mimeType: liveMimeType, data: input.liveMediaBuffer.toString("base64") } },
              {
                text:
                  `The first attachment is ${draftDescription}. ` +
                  `The second attachment is ${liveDescription} that's claimed to be the same ` +
                  "content, posted later. Does the second attachment look like it's from the " +
                  "same clip (same subject, setting, edit) as the first? Judge on visual " +
                  "content only.",
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
      }), "compareDraftToLive");

      return JSON.parse(res.text ?? "{}") as { same: boolean; confidence: number; reason: string };
    } catch (err) {
      this.logger.warn(`compareDraftToLivePreview failed: ${err}`);
      return null;
    }
  }
}
