import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiProperty, ApiTags } from "@nestjs/swagger";

import { AppVersionService } from "./app-version.service";

class PlatformVersionDto {
  @ApiProperty({ example: "1.2.0", nullable: true })
  latestVersion!: string | null;

  @ApiProperty({ nullable: true })
  storeUrl!: string | null;
}

class AppVersionDto {
  @ApiProperty({ type: PlatformVersionDto })
  ios!: PlatformVersionDto;

  @ApiProperty({ type: PlatformVersionDto })
  android!: PlatformVersionDto;
}

@ApiTags("app-version")
@Controller("app-version")
export class AppVersionController {
  constructor(private readonly appVersion: AppVersionService) {}

  @Get()
  @ApiOkResponse({ type: AppVersionDto, description: "Latest published app version per platform" })
  getVersions() {
    return this.appVersion.getVersions();
  }
}
