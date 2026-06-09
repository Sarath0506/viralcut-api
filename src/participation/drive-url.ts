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

export const GOOGLE_DRIVE_URL_MESSAGE =
  "draftDriveUrl must be a Google Drive link (https://drive.google.com/...) with sharing set to Anyone with the link";
