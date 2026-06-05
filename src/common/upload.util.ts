import { existsSync, mkdirSync } from "node:fs";
import { extname, join } from "node:path";
import { randomBytes } from "node:crypto";

export function ensureUploadDir(...segments: string[]): string {
  const dir = join(process.cwd(), "uploads", ...segments);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

const MIME_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
};

export function uploadFilename(originalname: string, mimetype: string): string {
  const ext = extname(originalname) || MIME_EXT[mimetype] || "";
  return `${Date.now()}-${randomBytes(8).toString("hex")}${ext}`;
}

export { MIME_EXT };
