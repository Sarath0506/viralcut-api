/** Not campaign-configurable for now — a fixed split applied to a marketplace
 * repost's already-capped payout (see computeEstimatedPaise), never to the
 * campaign pool math itself. */
export const MARKETPLACE_POSTER_SHARE_BPS = 7000;
export const MARKETPLACE_ORIGINAL_CREATOR_SHARE_BPS = 3000;

/** Splits a marketplace repost's capped payout 70/30 (poster/original
 * creator). The remainder of the floor division goes to the original
 * creator so the two shares always sum exactly to totalPaise — no paise is
 * ever lost to rounding. */
export function computeMarketplaceSplitPaise(totalPaise: number): {
  posterSharePaise: number;
  originalCreatorSharePaise: number;
} {
  const posterSharePaise = Math.floor(
    (totalPaise * MARKETPLACE_POSTER_SHARE_BPS) / 10000,
  );
  return {
    posterSharePaise,
    originalCreatorSharePaise: totalPaise - posterSharePaise,
  };
}
