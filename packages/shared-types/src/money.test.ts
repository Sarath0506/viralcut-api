import { describe, expect, it } from "vitest";

import {
  computeEarningsPaise,
  computeWithdrawalFeePaise,
} from "./index.js";

describe("money", () => {
  it("computes earnings: (views/1000) * rate_per_1k in paise", () => {
    // ₹50 / 1K views => 5000 paise per 1K
    expect(computeEarningsPaise(4360, 5000)).toBe(21800);
  });

  it("computes 1.5% withdrawal fee", () => {
    expect(computeWithdrawalFeePaise(100_000, 150)).toBe(1500);
  });
});
