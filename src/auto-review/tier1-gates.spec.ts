import { describe, expect, it } from "vitest";

import {
  evaluateOwnershipGate,
  evaluatePlatformMatchGate,
  evaluateResolvesGate,
  stubDraftLiveMatchGate,
} from "./tier1-gates";

describe("evaluateResolvesGate", () => {
  it("passes when the post resolved", () => {
    expect(evaluateResolvesGate({ status: "resolved" }).status).toBe("pass");
  });

  it("hard-fails when the post is confirmed not found", () => {
    expect(evaluateResolvesGate({ status: "not_found" }).status).toBe("fail");
  });

  it("is unresolved (not failed) when the scrape itself couldn't confirm either way", () => {
    const result = evaluateResolvesGate({ status: "unresolved", reason: "network error" });
    expect(result.status).toBe("unresolved");
    expect(result.reason).toBe("network error");
  });
});

describe("evaluatePlatformMatchGate", () => {
  it("passes when the detected platform matches the campaign format", () => {
    expect(evaluatePlatformMatchGate("instagram", "instagram_reel").status).toBe("pass");
  });

  it("fails when the detected platform doesn't match", () => {
    expect(evaluatePlatformMatchGate("youtube", "instagram_reel").status).toBe("fail");
  });

  it("is unresolved when either platform can't be determined", () => {
    expect(evaluatePlatformMatchGate("unknown", "instagram_reel").status).toBe("unresolved");
  });
});

describe("evaluateOwnershipGate", () => {
  it("is unresolved when the creator has no official OAuth connection", () => {
    const result = evaluateOwnershipGate(null, { handle: "someone", platformUserId: "123" });
    expect(result.status).toBe("unresolved");
  });

  it("is unresolved when the live post's author can't be determined", () => {
    const connection = { platformHandle: "creator", platformUserId: "1" };
    expect(evaluateOwnershipGate(connection, null).status).toBe("unresolved");
  });

  it("passes when the connected platformUserId matches the scraped author", () => {
    const connection = { platformHandle: "creator", platformUserId: "1" };
    const result = evaluateOwnershipGate(connection, { handle: "different_handle", platformUserId: "1" });
    expect(result.status).toBe("pass");
  });

  it("passes when the connected handle matches case-insensitively", () => {
    const connection = { platformHandle: "Creator", platformUserId: "1" };
    const result = evaluateOwnershipGate(connection, { handle: "creator", platformUserId: "999" });
    expect(result.status).toBe("pass");
  });

  it("is unresolved (not failed) when connected but the author doesn't match — never auto-rejects on an identity mismatch", () => {
    const connection = { platformHandle: "creator", platformUserId: "1" };
    const result = evaluateOwnershipGate(connection, { handle: "someone_else", platformUserId: "999" });
    expect(result.status).toBe("unresolved");
  });
});

describe("stubDraftLiveMatchGate", () => {
  it("is always unresolved until Tier 2 lands", () => {
    expect(stubDraftLiveMatchGate().status).toBe("unresolved");
  });
});
