import { describe, expect, it } from "vitest";

import { isGoogleDriveUrl } from "./drive-url";

describe("isGoogleDriveUrl", () => {
  it("accepts drive file links", () => {
    expect(
      isGoogleDriveUrl("https://drive.google.com/file/d/abc123/view?usp=sharing"),
    ).toBe(true);
  });

  it("accepts drive open links", () => {
    expect(isGoogleDriveUrl("https://drive.google.com/open?id=abc123")).toBe(
      true,
    );
  });

  it("rejects non-drive hosts", () => {
    expect(isGoogleDriveUrl("https://dropbox.com/s/abc")).toBe(false);
    expect(isGoogleDriveUrl("https://docs.google.com/document/d/abc")).toBe(
      false,
    );
  });

  it("rejects http and invalid paths", () => {
    expect(
      isGoogleDriveUrl("http://drive.google.com/file/d/abc/view"),
    ).toBe(false);
    expect(isGoogleDriveUrl("https://drive.google.com/")).toBe(false);
  });
});
