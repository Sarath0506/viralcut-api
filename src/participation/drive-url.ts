const GOOGLE_DRIVE_HOST = "drive.google.com";

export function isGoogleDriveUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") return false;
  if (parsed.hostname.toLowerCase() !== GOOGLE_DRIVE_HOST) return false;

  const path = parsed.pathname.toLowerCase();
  return (
    path.startsWith("/file/") ||
    path.startsWith("/open") ||
    path.startsWith("/drive/")
  );
}

export function isUploadedFileUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    // Accept any URL containing /creator-drafts/ — our R2 upload path
    return parsed.pathname.includes("/creator-drafts/");
  } catch {
    return false;
  }
}

export function isValidDraftUrl(url: string): boolean {
  return isGoogleDriveUrl(url) || isUploadedFileUrl(url);
}

export const GOOGLE_DRIVE_URL_MESSAGE =
  "draftDriveUrl must be a Google Drive link (https://drive.google.com/...) with sharing set to Anyone with the link";

export const DRAFT_URL_MESSAGE =
  "draftDriveUrl must be a Google Drive link or an uploaded file URL";
