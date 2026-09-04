import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ffprobePath from "@ffprobe-installer/ffprobe";

import type { GateResult } from "./auto-review.types";

type ProbeStream = { width?: number; height?: number };

// Same reasoning as assertVideoIsPlayable in campaigns/video-compatibility.ts:
// ffprobe needs to seek for MP4 metadata (moov atom isn't always at the
// front), so this probes a short-lived temp file rather than a stream/URL.
function probeDimensions(filePath: string): Promise<ProbeStream | null> {
  return new Promise((resolve) => {
    const proc = spawn(ffprobePath.path, [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-print_format",
      "json",
      "-show_entries",
      "stream=width,height",
      "-i",
      filePath,
    ]);

    let stdout = "";
    proc.stdout.on("data", (chunk) => (stdout += chunk));
    proc.on("error", () => resolve(null));
    proc.on("close", (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      try {
        const streams = (JSON.parse(stdout).streams ?? []) as ProbeStream[];
        resolve(streams[0] ?? null);
      } catch {
        resolve(null);
      }
    });
  });
}

const VERTICAL_REQUIRED_PLATFORMS = new Set(["instagram_reel", "youtube_shorts"]);

/** Checks a draft's aspect ratio against what its campaign format needs —
 * currently just "is it vertical" for Reels/Shorts slots. Formats with no
 * strict orientation requirement (posts, tweets) always pass this gate. */
export async function checkFormatGate(
  videoBuffer: Buffer,
  platform: string,
): Promise<GateResult> {
  if (!VERTICAL_REQUIRED_PLATFORMS.has(platform)) {
    return {
      gate: "format_match",
      status: "pass",
      reason: `No strict aspect-ratio requirement for ${platform}`,
    };
  }

  const dir = await mkdtemp(join(tmpdir(), "auto-review-format-"));
  const filePath = join(dir, `${randomUUID()}.mp4`);
  try {
    await writeFile(filePath, videoBuffer);
    const stream = await probeDimensions(filePath);

    if (!stream?.width || !stream?.height) {
      return {
        gate: "format_match",
        status: "unresolved",
        reason: "Could not read video dimensions",
      };
    }

    if (stream.height > stream.width) {
      return {
        gate: "format_match",
        status: "pass",
        reason: `Vertical video (${stream.width}x${stream.height}) matches ${platform}`,
      };
    }
    return {
      gate: "format_match",
      status: "fail",
      reason: `Video is not vertical (${stream.width}x${stream.height}) — ${platform} requires vertical`,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
