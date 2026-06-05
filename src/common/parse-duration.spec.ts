import { describe, expect, it } from "vitest";

import { formatDurationLabel, parseDurationMs } from "./parse-duration";

describe("parseDurationMs", () => {
  it("parses hour/minute/second units", () => {
    expect(parseDurationMs("1h")).toBe(3_600_000);
    expect(parseDurationMs("30m")).toBe(1_800_000);
    expect(parseDurationMs("90s")).toBe(90_000);
  });

  it("falls back when invalid", () => {
    expect(parseDurationMs("invalid", "2h")).toBe(7_200_000);
  });
});

describe("formatDurationLabel", () => {
  it("formats for email copy", () => {
    expect(formatDurationLabel("1h")).toBe("1 hour");
    expect(formatDurationLabel("2h")).toBe("2 hours");
  });
});
