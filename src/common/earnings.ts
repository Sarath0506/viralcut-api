export function computeEstimatedPaise(
  viewCount: number,
  ratePer1kPaise: number,
  maxPayoutPaise: number,
): number {
  if (ratePer1kPaise <= 0) return 0;
  return Math.min(Math.floor((viewCount / 1000) * ratePer1kPaise), maxPayoutPaise);
}

/** The portion of a campaign's budget actually available to pay clippers,
 * after the platform fee. Used for any estimate derived from budgetPaise
 * (estimated views, minimum clippers needed, etc.) — never for the stored
 * Campaign.budgetPaise value itself, which stays the full gross amount. */
export function computePayableBudgetPaise(
  budgetPaise: number,
  platformFeeBps = 1500,
): number {
  if (!Number.isFinite(budgetPaise) || budgetPaise <= 0) return 0;
  return Math.floor((budgetPaise * (10000 - platformFeeBps)) / 10000);
}
