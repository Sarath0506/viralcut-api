import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ffprobePath from "@ffprobe-installer/ffprobe";

// The only pixel format iOS/Android hardware video decoders reliably support
// for H.264 playback. Files exported in editing/mastering-oriented profiles
// (e.g. H.264 High 4:4:4 Predictive, pix_fmt yuv444p) decode audio fine but
// silently produce no video frames — see the MutinyX reference asset bug.
const SUPPORTED_PIXEL_FORMATS = new Set(["yuv420p", "yuvj420p"]);

type ProbeStream = {
  codec_type?: string;
  pix_fmt?: string;
  profile?: string;
};

export class UnsupportedVideoFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedVideoFormatError";
  }
}

function probe(filePath: string): Promise<ProbeStream[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffprobePath.path, [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_entries",
      "stream=codec_type,pix_fmt,profile",
      "-i",
      filePath,
    ]);

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => (stdout += chunk));
    proc.stderr.on("data", (chunk) => (stderr += chunk));

    proc.on("error", (err) => reject(err));

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with code ${code}: ${stderr}`));
        return;
      }
      try {
        resolve((JSON.parse(stdout).streams ?? []) as ProbeStream[]);
      } catch (e) {
        reject(new Error(`Failed to parse ffprobe output: ${e}`));
      }
    });
  });
}

/**
 * Rejects videos whose picture track uses a pixel format phones can't
 * hardware-decode, before they ever reach a campaign. ffprobe needs to seek
 * within the file to read MP4 metadata (the moov atom isn't always at the
 * front), so the upload is written to a short-lived temp file rather than
 * piped — an in-memory stream isn't seekable.
 */
export async function assertVideoIsPlayable(buffer: Buffer): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "video-check-"));
  const filePath = join(dir, `${randomUUID()}.mp4`);
  try {
    await writeFile(filePath, buffer);
    const streams = await probe(filePath);

    const videoStream = streams.find((s) => s.codec_type === "video");
    if (!videoStream) {
      throw new UnsupportedVideoFormatError(
        "Could not read a video track from this file. Please upload a valid video.",
      );
    }

    if (!SUPPORTED_PIXEL_FORMATS.has(videoStream.pix_fmt ?? "")) {
      throw new UnsupportedVideoFormatError(
        `This video is encoded in a format phones can't play (${videoStream.pix_fmt ?? "unknown"}` +
          `${videoStream.profile ? `, profile: ${videoStream.profile}` : ""}). ` +
          "Please re-export it as standard H.264 (yuv420p) and upload again.",
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
