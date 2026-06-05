import { describe, expect, it } from "vitest";

/** Mirrors apps/web-brand-spa estimate-views.ts */
function estimateViewsFromBudget(
  budgetRupees: number,
  ratePer1kRupees: number,
): number {
  if (
    !Number.isFinite(budgetRupees) ||
    !Number.isFinite(ratePer1kRupees) ||
    ratePer1kRupees <= 0 ||
    budgetRupees <= 0
  ) {
    return 0;
  }
  return Math.floor((budgetRupees / ratePer1kRupees) * 1000);
}

describe("estimateViewsFromBudget", () => {
  it("computes views from budget and rate", () => {
    expect(estimateViewsFromBudget(100_000, 50)).toBe(2_000_000);
    expect(estimateViewsFromBudget(10_000, 100)).toBe(100_000);
  });

  it("returns 0 for invalid inputs", () => {
    expect(estimateViewsFromBudget(0, 50)).toBe(0);
    expect(estimateViewsFromBudget(1000, 0)).toBe(0);
    expect(estimateViewsFromBudget(NaN, 50)).toBe(0);
  });

  it("floors fractional views", () => {
    expect(estimateViewsFromBudget(1000, 300)).toBe(3333);
  });
});
