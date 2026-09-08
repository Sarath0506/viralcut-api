import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ffmpegPath from "@ffmpeg-installer/ffmpeg";

const COMPRESS_TIMEOUT_MS = 45_000;

/** Downscales a video for a Gemini comparison call — the pipeline only
 * needs to tell whether a clip visually derives from this footage, not see
 * it at full resolution/bitrate. A raw 4K phone recording can be tens of
 * MB; sending one inline to Gemini alongside the draft made a single
 * compliance check take several minutes and never actually complete in a
 * live test (confirmed: a real 62MB 4K source video effectively hung the
 * request). Scaling to at most 640px on the long side keeps the full
 * duration but cuts typical 4K footage down to a few MB, in a few seconds.
 * Returns null on any failure — timeout, missing ffmpeg, corrupt input —
 * so callers can skip the source-video comparison rather than block or
 * crash the rest of the pipeline. */
export async function compressVideoForGemini(buffer: Buffer): Promise<Buffer | null> {
  const dir = await mkdtemp(join(tmpdir(), "auto-review-compress-"));
  const inPath = join(dir, `${randomUUID()}-in.mp4`);
  const outPath = join(dir, `${randomUUID()}-out.mp4`);
  try {
    await writeFile(inPath, buffer);
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpegPath.path, [
        "-y",
        "-i",
        inPath,
        "-vf",
        "scale=640:640:force_original_aspect_ratio=decrease",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "30",
        "-c:a",
        "aac",
        "-b:a",
        "96k",
        "-movflags",
        "+faststart",
        outPath,
      ]);

      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        reject(new Error("ffmpeg compression timed out"));
      }, COMPRESS_TIMEOUT_MS);

      let stderr = "";
      proc.stderr.on("data", (chunk) => (stderr += chunk));
      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      proc.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
          return;
        }
        resolve();
      });
    });
    return await readFile(outPath);
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
