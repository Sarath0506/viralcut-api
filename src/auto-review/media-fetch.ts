import { Logger } from "@nestjs/common";

const logger = new Logger("AutoReviewMediaFetch");

// Gemini's inline-data path tops out at 100MB; anything larger needs the
// Files API (not implemented in this pass — falls back to unresolved
// instead, same as any other unfetchable-media case in this pipeline).
const MAX_INLINE_BYTES = 95 * 1024 * 1024;

const EXTENSION_MIME_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  webm: "video/webm",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

function guessMimeType(url: string, contentTypeHeader: string | null): string {
  // A real Content-Type header wins when present and specific (R2/S3 sets
  // this from the upload's original mimetype) — the file extension is a
  // fallback for URLs that don't carry one.
  if (contentTypeHeader && contentTypeHeader !== "application/octet-stream") {
    return contentTypeHeader.split(";")[0].trim();
  }
  const path = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  })();
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_MIME_TYPES[ext] ?? "video/mp4";
}

export type FetchedMedia = { buffer: Buffer; mimeType: string };

/** Fetches a draft/live media file's raw bytes for local inspection
 * (ffprobe) and inline Gemini calls, along with its actual mime type —
 * callers submitting this to Gemini need the real type, not an assumed
 * "video/mp4" for everything (a mislabeled request produces a genuine
 * Gemini-side 500, not a clean validation error — confirmed live against a
 * real .jpg draft). Returns null on any failure — timeout, non-2xx, too
 * large — so callers can treat "couldn't fetch" as unresolved rather than
 * crashing. */
export async function fetchMedia(url: string): Promise<FetchedMedia | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    const res = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
    if (!res.ok) {
      logger.warn(`Fetch failed for ${url}: HTTP ${res.status}`);
      return null;
    }
    const contentLength = res.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_INLINE_BYTES) {
      logger.warn(`Media at ${url} is ${contentLength} bytes — over the inline-fetch cap`);
      return null;
    }
    const mimeType = guessMimeType(url, res.headers.get("content-type"));
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_INLINE_BYTES) {
      logger.warn(`Media at ${url} is ${buf.byteLength} bytes — over the inline-fetch cap`);
      return null;
    }
    return { buffer: buf, mimeType };
  } catch (err) {
    logger.warn(`Fetch error for ${url}: ${err}`);
    return null;
  }
}
