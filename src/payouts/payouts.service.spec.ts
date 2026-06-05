import { describe, expect, it } from "vitest";
function computeWithdrawalFeePaise(amountPaise: number, feeBps: number): number {
  return Math.floor((amountPaise * feeBps) / 10000);
}

describe("PayoutsService fee math", () => {
  it("applies 1.5% fee on withdrawal amount", () => {
    const amount = 1_000_000;
    const fee = computeWithdrawalFeePaise(amount, 150);
    expect(fee).toBe(15_000);
    expect(amount - fee).toBe(985_000);
  });
});
