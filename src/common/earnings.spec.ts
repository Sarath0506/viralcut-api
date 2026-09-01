import { describe, expect, it } from "vitest";

import { computeEstimatedPaise, computePayableBudgetPaise } from "./earnings";

describe("computeEstimatedPaise", () => {
  it("computes rate * views/1000, floored", () => {
    expect(computeEstimatedPaise(12_345, 1_000, 1_000_000)).toBe(12_345);
    // 777 views at 1000 paise/1k = 777 paise exactly; 778 introduces a
    // fractional views/1000 that must floor rather than round.
    expect(computeEstimatedPaise(1_234, 777, 1_000_000)).toBe(958);
  });

  it("caps at maxPayoutPaise", () => {
    expect(computeEstimatedPaise(500_000, 1_000, 50_000)).toBe(50_000);
  });

  it("returns 0 for a non-positive rate", () => {
    expect(computeEstimatedPaise(100_000, 0, 50_000)).toBe(0);
  });
});

describe("computePayableBudgetPaise", () => {
  it("deducts the default 15% platform fee", () => {
    expect(computePayableBudgetPaise(100_000)).toBe(85_000);
  });

  it("accepts a custom fee in basis points", () => {
    expect(computePayableBudgetPaise(100_000, 1000)).toBe(90_000); // 10%
    expect(computePayableBudgetPaise(100_000, 0)).toBe(100_000); // no fee
  });

  it("floors fractional paise", () => {
    expect(computePayableBudgetPaise(999, 1500)).toBe(849); // 999 * 0.85 = 849.15
  });

  it("returns 0 for non-positive or non-finite budgets", () => {
    expect(computePayableBudgetPaise(0)).toBe(0);
    expect(computePayableBudgetPaise(-500)).toBe(0);
    expect(computePayableBudgetPaise(NaN)).toBe(0);
  });
});
