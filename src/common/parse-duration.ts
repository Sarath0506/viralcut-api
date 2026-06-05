const UNIT_MS = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
} as const;

/** Parses durations like `1h`, `30m`, `3600s`. Defaults to 1 hour if invalid. */
export function parseDurationMs(ttl: string, fallback = "1h"): number {
  const value = parseSingleDuration(ttl) ?? parseSingleDuration(fallback);
  return value ?? 3_600_000;
}

function parseSingleDuration(ttl: string): number | null {
  const match = /^(\d+)(s|m|h|d)$/i.exec(ttl.trim());
  if (!match) return null;
  const amount = Number.parseInt(match[1]!, 10);
  const unit = match[2]!.toLowerCase() as keyof typeof UNIT_MS;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount * UNIT_MS[unit];
}

export function formatDurationLabel(ttl: string): string {
  const match = /^(\d+)(s|m|h|d)$/i.exec(ttl.trim());
  if (!match) return ttl;
  const amount = match[1];
  const unit = match[2]!.toLowerCase();
  const labels: Record<string, string> = {
    s: "second",
    m: "minute",
    h: "hour",
    d: "day",
  };
  const label = labels[unit] ?? unit;
  return `${amount} ${label}${amount === "1" ? "" : "s"}`;
}
