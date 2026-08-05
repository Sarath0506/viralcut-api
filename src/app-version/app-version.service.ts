import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { Env } from "../config/env";

export type PlatformVersionInfo = {
  latestVersion: string | null;
  storeUrl: string | null;
};

@Injectable()
export class AppVersionService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  getVersions(): { ios: PlatformVersionInfo; android: PlatformVersionInfo } {
    return {
      ios: {
        latestVersion: this.config.get("APP_LATEST_IOS_VERSION", { infer: true }) ?? null,
        storeUrl: this.config.get("APP_STORE_URL", { infer: true }) ?? null,
      },
      android: {
        latestVersion: this.config.get("APP_LATEST_ANDROID_VERSION", { infer: true }) ?? null,
        storeUrl: this.config.get("PLAY_STORE_URL", { infer: true }) ?? null,
      },
    };
  }
}
