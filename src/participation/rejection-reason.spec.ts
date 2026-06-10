import { describe, expect, it } from "vitest";

import {
  isDuplicateRejectionReason,
  normalizeRejectionReason,
} from "./rejection-reason";

describe("rejection-reason", () => {
  it("normalizes whitespace and case", () => {
    expect(normalizeRejectionReason("  Wrong   Aspect Ratio  ")).toBe(
      "wrong aspect ratio",
    );
  });

  it("detects duplicate reasons", () => {
    expect(
      isDuplicateRejectionReason("Wrong aspect ratio", [
        "wrong  aspect   ratio",
      ]),
    ).toBe(true);
    expect(
      isDuplicateRejectionReason("Missing logo", ["Wrong aspect ratio"]),
    ).toBe(false);
  });
});
