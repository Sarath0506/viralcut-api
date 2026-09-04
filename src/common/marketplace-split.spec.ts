import { describe, expect, it } from "vitest";

import { computeMarketplaceSplitPaise } from "./marketplace-split";

describe("computeMarketplaceSplitPaise", () => {
  it("splits 70/30 poster/original-creator", () => {
    expect(computeMarketplaceSplitPaise(1000)).toEqual({
      posterSharePaise: 700,
      originalCreatorSharePaise: 300,
    });
  });

  it("always conserves the total exactly, even where 70% doesn't divide evenly", () => {
    for (const total of [1, 3, 7, 99, 101, 12345, 999999]) {
      const { posterSharePaise, originalCreatorSharePaise } = computeMarketplaceSplitPaise(total);
      expect(posterSharePaise + originalCreatorSharePaise).toBe(total);
      expect(posterSharePaise).toBeGreaterThanOrEqual(0);
      expect(originalCreatorSharePaise).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns zero shares for a zero total", () => {
    expect(computeMarketplaceSplitPaise(0)).toEqual({
      posterSharePaise: 0,
      originalCreatorSharePaise: 0,
    });
  });
});
