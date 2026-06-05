import { describe, expect, it } from "vitest";

import { hashRefreshToken } from "./otp.service";

describe("password reset token hashing", () => {
  it("hashes tokens deterministically for lookup", () => {
    const raw = "abc123def456";
    expect(hashRefreshToken(raw)).toBe(hashRefreshToken(raw));
    expect(hashRefreshToken(raw)).not.toBe(raw);
  });
});
