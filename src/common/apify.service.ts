import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export type PlatformViewResult = {
  viewCount: number;
  reach: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  platform: "instagram" | "youtube" | "twitter" | "unknown";
};

export type SocialProfileStats = {
  platform: "instagram" | "youtube" | "twitter";
  handle: string;
  displayName: string | null;
  followersCount: number;
  followingCount: number;
  postsCount: number;
  profilePicUrl: string | null;
  bio: string | null;
  fetchedAt: string;
};

@Injectable()
export class ApifyService {
  private readonly logger = new Logger(ApifyService.name);
  private readonly apiToken: string | null;

  // Apify actor IDs for each platform
  private static readonly ACTORS = {
    instagram: "apify~instagram-scraper",
    youtube: "streamers~youtube-scraper",
    twitter: "apidojo~tweet-scraper",
  };

  constructor(private readonly config: ConfigService) {
    this.apiToken = this.config.get<string>("APIFY_API_TOKEN") ?? null;
  }

  get isConfigured(): boolean {
    return !!this.apiToken;
  }

  async getViewCount(livePostUrl: string): Promise<PlatformViewResult> {
    const platform = this.detectPlatform(livePostUrl);

    const zero: PlatformViewResult = {
      viewCount: 0, reach: 0, likeCount: 0, commentCount: 0, shareCount: 0, platform,
    };

    if (!this.isConfigured) {
      this.logger.warn("APIFY_API_TOKEN not set — returning 0 metrics");
      return zero;
    }

    try {
      switch (platform) {
        case "instagram": return { ...(await this.scrapeInstagram(livePostUrl)), platform };
        case "youtube":   return { ...(await this.scrapeYouTube(livePostUrl)), platform };
        case "twitter":   return { ...(await this.scrapeTwitter(livePostUrl)), platform };
        default:          return zero;
      }
    } catch (err) {
      this.logger.error(`Apify scrape failed for ${livePostUrl}: ${err}`);
      return zero;
    }
  }

  private detectPlatform(url: string): PlatformViewResult["platform"] {
    if (/instagram\.com/i.test(url)) return "instagram";
    if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
    if (/twitter\.com|x\.com/i.test(url)) return "twitter";
    return "unknown";
  }

  private async runActorAndGetDataset(actorId: string, input: object): Promise<any[]> {
    const baseUrl = "https://api.apify.com/v2";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 150_000);
    const runRes = await fetch(
      `${baseUrl}/acts/${actorId}/run-sync-get-dataset-items?token=${this.apiToken}&timeout=120`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: controller.signal,
      },
    ).finally(() => clearTimeout(timer));
    if (!runRes.ok) {
      const body = await runRes.text();
      throw new Error(`Apify actor ${actorId} returned ${runRes.status}: ${body}`);
    }
    const items = await runRes.json() as any[];
    this.logger.log(`Apify ${actorId} returned ${items.length} items: ${JSON.stringify(items[0] ?? {})}`);
    return items;
  }

  private async scrapeInstagram(url: string): Promise<Omit<PlatformViewResult, "platform">> {
    const items = await this.runActorAndGetDataset(ApifyService.ACTORS.instagram, {
      directUrls: [url],
      resultsType: "posts",
      resultsLimit: 1,
    });
    const p = items[0] ?? {};
    return {
      viewCount:    p.videoViewCount ?? p.playCount ?? 0,
      reach:        p.reachCount ?? p.videoViewCount ?? p.playCount ?? 0,
      likeCount:    p.likesCount ?? p.likes ?? 0,
      commentCount: p.commentsCount ?? p.comments ?? 0,
      shareCount:   p.sharesCount ?? p.shares ?? 0,
    };
  }

  private async scrapeYouTube(url: string): Promise<Omit<PlatformViewResult, "platform">> {
    const items = await this.runActorAndGetDataset(ApifyService.ACTORS.youtube, {
      startUrls: [{ url }],
      maxResults: 1,
    });
    const v = items[0] ?? {};
    return {
      viewCount:    v.viewCount ?? v.views ?? 0,
      reach:        v.viewCount ?? v.views ?? 0,
      likeCount:    v.likes ?? v.likeCount ?? 0,
      commentCount: v.commentCount ?? v.comments ?? 0,
      shareCount:   0,
    };
  }

  private async scrapeTwitter(url: string): Promise<Omit<PlatformViewResult, "platform">> {
    const items = await this.runActorAndGetDataset(ApifyService.ACTORS.twitter, {
      startUrls: [url],
      maxItems: 1,
    });
    const t = items[0] ?? {};
    return {
      viewCount:    t.viewCount ?? t.views ?? t.impressions ?? 0,
      reach:        t.impressions ?? t.views ?? 0,
      likeCount:    t.likeCount ?? t.likes ?? t.favoriteCount ?? 0,
      commentCount: t.replyCount ?? t.replies ?? 0,
      shareCount:   t.retweetCount ?? t.retweets ?? 0,
    };
  }

  /** Normalise a handle/username input to a full profile URL for the platform. */
  normalizeProfileUrl(platform: "instagram" | "youtube" | "twitter", input: string): string {
    const s = input.trim().replace(/^@/, "");
    if (platform === "instagram") {
      if (/instagram\.com/i.test(s)) return s.split("?")[0];
      return `https://www.instagram.com/${s}/`;
    }
    if (platform === "youtube") {
      if (/youtube\.com|youtu\.be/i.test(s)) return s;
      return `https://www.youtube.com/@${s}`;
    }
    // twitter
    if (/twitter\.com|x\.com/i.test(s)) return s;
    return `https://x.com/${s}`;
  }

  async getSocialProfileStats(
    platform: "instagram" | "youtube" | "twitter",
    handleOrUrl: string,
  ): Promise<SocialProfileStats | null> {
    if (!this.isConfigured) return null;
    const profileUrl = this.normalizeProfileUrl(platform, handleOrUrl);
    try {
      if (platform === "instagram") return await this.fetchInstagramProfile(profileUrl);
      if (platform === "youtube") return await this.fetchYouTubeProfile(profileUrl);
      return await this.fetchTwitterProfile(profileUrl);
    } catch (err) {
      this.logger.error(`Profile stats failed for ${platform}/${handleOrUrl}: ${err}`);
      return null;
    }
  }

  private async fetchInstagramProfile(profileUrl: string): Promise<SocialProfileStats> {
    // Extract username from URL or raw input
    const username = profileUrl
      .replace(/\/$/, "")
      .split("/")
      .filter(Boolean)
      .pop()
      ?.split("?")[0] ?? "";

    let items: any[] = [];

    // Primary: use usernames field (more reliable than directUrls for profiles)
    try {
      items = await this.runActorAndGetDataset(ApifyService.ACTORS.instagram, {
        usernames: [username],
        resultsType: "details",
        resultsLimit: 1,
      });
    } catch (_) {
      // Fallback to directUrls
      items = await this.runActorAndGetDataset(ApifyService.ACTORS.instagram, {
        directUrls: [profileUrl],
        resultsType: "details",
        resultsLimit: 1,
      });
    }

    if (!items.length || items[0]?.error) {
      throw new Error(`Instagram: no profile found for "${username}". Account may be private or not exist.`);
    }

    const p = items[0];
    return {
      platform: "instagram",
      handle: p.username ?? username,
      displayName: p.fullName ?? p.name ?? null,
      followersCount: p.followersCount ?? p.followers ?? 0,
      followingCount: p.followsCount ?? p.following ?? 0,
      postsCount: p.postsCount ?? p.mediaCount ?? p.igtvVideoCount ?? 0,
      profilePicUrl: p.profilePicUrl ?? p.profilePicUrlHD ?? null,
      bio: p.biography ?? null,
      fetchedAt: new Date().toISOString(),
    };
  }

  private async fetchYouTubeProfile(channelUrl: string): Promise<SocialProfileStats> {
    const items = await this.runActorAndGetDataset(ApifyService.ACTORS.youtube, {
      startUrls: [{ url: channelUrl }],
      maxResults: 1,
    });
    const c = items[0] ?? {};
    return {
      platform: "youtube",
      handle: c.channelHandle ?? c.channel ?? channelUrl,
      displayName: c.channelName ?? c.title ?? null,
      followersCount: c.subscriberCount ?? c.subscribers ?? 0,
      followingCount: 0,
      postsCount: c.videoCount ?? c.videos ?? 0,
      profilePicUrl: c.channelThumbnail ?? null,
      bio: c.channelDescription ?? null,
      fetchedAt: new Date().toISOString(),
    };
  }

  private async fetchTwitterProfile(profileUrl: string): Promise<SocialProfileStats> {
    const handle = profileUrl.replace(/\/$/, "").split("/").pop() ?? "";
    const items = await this.runActorAndGetDataset("apidojo~twitter-user-scraper", {
      usernames: [handle],
      maxItems: 1,
    });
    const u = items[0] ?? {};
    return {
      platform: "twitter",
      handle: u.userName ?? u.username ?? handle,
      displayName: u.displayName ?? u.name ?? null,
      followersCount: u.followersCount ?? u.followers ?? 0,
      followingCount: u.followingCount ?? u.following ?? 0,
      postsCount: u.tweetCount ?? u.statusesCount ?? 0,
      profilePicUrl: u.profilePicture ?? u.profileImageUrl ?? null,
      bio: u.description ?? null,
      fetchedAt: new Date().toISOString(),
    };
  }
}
