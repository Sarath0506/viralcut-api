import { describe, expect, it } from "vitest";

import {
  DEFAULT_CAMPAIGN_PLATFORM,
  normalizeCampaignPlatforms,
} from "./campaign-platforms";

describe("normalizeCampaignPlatforms", () => {
  it("defaults to instagram_reel when empty", () => {
    expect(normalizeCampaignPlatforms()).toEqual(["instagram_reel"]);
    expect(normalizeCampaignPlatforms([], undefined)).toEqual([
      DEFAULT_CAMPAIGN_PLATFORM,
    ]);
  });

  it("remaps legacy instagram_reels to instagram_reel", () => {
    expect(normalizeCampaignPlatforms(["instagram_reels"])).toEqual([
      "instagram_reel",
    ]);
    expect(
      normalizeCampaignPlatforms(undefined, "instagram_reels"),
    ).toEqual(["instagram_reel"]);
  });

  it("preserves multi-platform selection", () => {
    expect(
      normalizeCampaignPlatforms([
        "instagram_reel",
        "instagram_post",
        "youtube_shorts",
        "twitter_tweet",
      ]),
    ).toEqual([
      "instagram_reel",
      "instagram_post",
      "youtube_shorts",
      "twitter_tweet",
    ]);
  });
});
