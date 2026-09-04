import { Logger } from "@nestjs/common";

const logger = new Logger("AutoReviewMediaFetch");

// Gemini's inline-data path tops out at 100MB; anything larger needs the
// Files API (not implemented in this pass — falls back to unresolved
// instead, same as any other unfetchable-media case in this pipeline).
const MAX_INLINE_BYTES = 95 * 1024 * 1024;

/** Fetches a video's raw bytes for local inspection (ffprobe) and inline
 * Gemini calls. Returns null on any failure — timeout, non-2xx, too large —
 * so callers can treat "couldn't fetch" as unresolved rather than crashing. */
export async function fetchVideoBuffer(url: string): Promise<Buffer | null> {
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
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_INLINE_BYTES) {
      logger.warn(`Media at ${url} is ${buf.byteLength} bytes — over the inline-fetch cap`);
      return null;
    }
    return buf;
  } catch (err) {
    logger.warn(`Fetch error for ${url}: ${err}`);
    return null;
  }
}
