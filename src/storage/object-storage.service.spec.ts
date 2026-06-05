import { describe, expect, it } from "vitest";

import { buildR2UploadResponse } from "./object-storage.service";

describe("buildR2UploadResponse", () => {
  it("builds a public URL from base URL and object key", () => {
    expect(
      buildR2UploadResponse(
        "https://pub-example.r2.dev/",
        "cover-images/123-photo.jpg",
        "photo.jpg",
      ),
    ).toEqual({
      url: "https://pub-example.r2.dev/cover-images/123-photo.jpg",
      path: "https://pub-example.r2.dev/cover-images/123-photo.jpg",
      name: "photo.jpg",
    });
  });
});
