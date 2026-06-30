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
    const runRes = await fetch(
      `${baseUrl}/acts/${actorId}/run-sync-get-dataset-items?token=${this.apiToken}&timeout=60`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
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
}
