import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InstagramOAuthService } from "./instagram-oauth.service";

function makePrisma() {
  return {
    instagramConnection: { findUnique: vi.fn() },
  };
}

function makeConfig() {
  const values: Record<string, string> = {
    INSTAGRAM_GRAPH_API_VERSION: "v23.0",
    INSTAGRAM_TOKEN_ENCRYPTION_KEY: "test-encryption-key-not-a-real-secret",
  };
  return { get: vi.fn((key: string) => values[key]) };
}

function makeResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 400,
    json: async () => body,
  } as unknown as Response;
}

describe("InstagramOAuthService.getMediaInsightsForPost", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: InstagramOAuthService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new InstagramOAuthService(prisma as never, {} as never, makeConfig() as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function connectedRow(overrides: Record<string, unknown> = {}) {
    // Encrypt with the real method so getValidAccessToken's decrypt() round-trips —
    // exercises the actual crypto path rather than mocking it away.
    const encryptedAccessToken = (service as unknown as { encrypt(v: string): string }).encrypt("real-token");
    return {
      creatorProfileId: "profile-1",
      platformUserId: "ig-user-1",
      isConnected: true,
      encryptedAccessToken,
      tokenExpiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      ...overrides,
    };
  }

  it("returns null immediately for a URL that isn't a recognizable Instagram post/reel link", async () => {
    const result = await service.getMediaInsightsForPost("profile-1", "https://example.com/not-instagram");
    expect(result).toBeNull();
    expect(prisma.instagramConnection.findUnique).not.toHaveBeenCalled();
  });

  it("returns null when the creator has no connected Instagram account", async () => {
    prisma.instagramConnection.findUnique.mockResolvedValue(null);

    const result = await service.getMediaInsightsForPost(
      "profile-1",
      "https://www.instagram.com/reel/Cxyz123/",
    );

    expect(result).toBeNull();
  });

  it("returns null when the connection exists but isConnected is false", async () => {
    prisma.instagramConnection.findUnique.mockResolvedValue(connectedRow({ isConnected: false }));

    const result = await service.getMediaInsightsForPost(
      "profile-1",
      "https://www.instagram.com/reel/Cxyz123/",
    );

    expect(result).toBeNull();
  });

  it("matches the post by shortcode (ignoring query params/trailing slash) and returns mapped metrics", async () => {
    prisma.instagramConnection.findUnique.mockResolvedValue(connectedRow());
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/media?")) {
        return makeResponse({
          data: [
            { id: "other-media", permalink: "https://www.instagram.com/reel/Different1/" },
            { id: "media-42", permalink: "https://www.instagram.com/reel/Cxyz123/" },
          ],
        });
      }
      if (u.includes("/insights?")) {
        return makeResponse({
          data: [
            { name: "views", total_value: { value: 12345 } },
            { name: "reach", total_value: { value: 9000 } },
            { name: "likes", values: [{ value: 500 }] },
            { name: "comments", total_value: { value: 20 } },
            { name: "shares", total_value: { value: 7 } },
          ],
        });
      }
      throw new Error(`unexpected fetch: ${u}`);
    });

    const result = await service.getMediaInsightsForPost(
      "profile-1",
      "https://www.instagram.com/reel/Cxyz123/?utm_source=ig_web_copy_link",
    );

    expect(result).toEqual({
      viewCount: 12345,
      reach: 9000,
      likeCount: 500,
      commentCount: 20,
      shareCount: 7,
      platform: "instagram",
    });
    // Confirms the insights call was made against the matched media id, not the other one.
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining("/media-42/insights"), expect.anything());
  });

  it("returns null when the post isn't among the account's recent media (fallback to Apify is the caller's job)", async () => {
    prisma.instagramConnection.findUnique.mockResolvedValue(connectedRow());
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      makeResponse({ data: [{ id: "other-media", permalink: "https://www.instagram.com/reel/Different1/" }] }),
    );

    const result = await service.getMediaInsightsForPost(
      "profile-1",
      "https://www.instagram.com/reel/NotFound99/",
    );

    expect(result).toBeNull();
  });

  it("returns null (never throws) when the Graph API denies the insights permission", async () => {
    prisma.instagramConnection.findUnique.mockResolvedValue(connectedRow());
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/media?")) {
        return makeResponse({ data: [{ id: "media-42", permalink: "https://www.instagram.com/reel/Cxyz123/" }] });
      }
      // Simulates a token that lacks instagram_business_manage_insights.
      return makeResponse({ error: { message: "Permission denied", code: 10 } }, false);
    });

    const result = await service.getMediaInsightsForPost(
      "profile-1",
      "https://www.instagram.com/reel/Cxyz123/",
    );

    expect(result).toBeNull();
  });

  it("returns null (never throws) on a network error", async () => {
    prisma.instagramConnection.findUnique.mockResolvedValue(connectedRow());
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    const result = await service.getMediaInsightsForPost(
      "profile-1",
      "https://www.instagram.com/reel/Cxyz123/",
    );

    expect(result).toBeNull();
  });
});
