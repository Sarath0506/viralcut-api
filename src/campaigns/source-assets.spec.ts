import { describe, expect, it } from "vitest";

type SourceAsset = { type: "drive" | "youtube"; url: string; label?: string };

function toApiSourceAssets(
  assets: Array<{ type: "drive" | "youtube"; url: string; label: string }>,
): SourceAsset[] {
  return assets
    .map((asset) => ({
      type: asset.type,
      url: asset.url.trim(),
      label: asset.label.trim() || undefined,
    }))
    .filter((asset) => asset.url.length > 0);
}

describe("toApiSourceAssets", () => {
  it("trims URLs and drops empty rows", () => {
    expect(
      toApiSourceAssets([
        { type: "drive", url: "  https://drive.google.com/x  ", label: "" },
        { type: "youtube", url: "   ", label: "skip" },
        {
          type: "youtube",
          url: "https://youtube.com/watch?v=1",
          label: "Demo",
        },
      ]),
    ).toEqual([
      { type: "drive", url: "https://drive.google.com/x", label: undefined },
      {
        type: "youtube",
        url: "https://youtube.com/watch?v=1",
        label: "Demo",
      },
    ]);
  });
});
