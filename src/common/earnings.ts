export function computeEstimatedPaise(
  viewCount: number,
  ratePer1kPaise: number,
  maxPayoutPaise: number,
): number {
  if (ratePer1kPaise <= 0) return 0;
  return Math.min(Math.floor((viewCount / 1000) * ratePer1kPaise), maxPayoutPaise);
}
