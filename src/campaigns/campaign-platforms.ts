export const CAMPAIGN_PLATFORM_IDS = [
  "instagram_reel",
  "instagram_post",
  "youtube_shorts",
  "twitter_tweet",
] as const;

export type CampaignPlatformId = (typeof CAMPAIGN_PLATFORM_IDS)[number];

export const DEFAULT_CAMPAIGN_PLATFORM: CampaignPlatformId = "instagram_reel";

export function normalizeCampaignPlatforms(
  platforms?: string[],
  legacyPlatform?: string,
): CampaignPlatformId[] {
  const raw =
    platforms && platforms.length > 0
      ? platforms
      : [legacyPlatform ?? DEFAULT_CAMPAIGN_PLATFORM];

  return raw.map((id) =>
    id === "instagram_reels" ? "instagram_reel" : id,
  ) as CampaignPlatformId[];
}
