export const REJECTION_HISTORY_LIMIT = 10;

export function normalizeRejectionReason(reason: string): string {
  return reason.trim().toLowerCase().replace(/\s+/g, " ");
}

export function isDuplicateRejectionReason(
  reason: string,
  priorReasons: string[],
): boolean {
  const normalized = normalizeRejectionReason(reason);
  return priorReasons.some((r) => normalizeRejectionReason(r) === normalized);
}
