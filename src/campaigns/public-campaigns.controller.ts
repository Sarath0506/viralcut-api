import { Controller, Get, Param } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";

import { ParticipationService } from "../participation/participation.service";
import { CampaignsService } from "./campaigns.service";

@ApiTags("public")
@Controller("public/campaigns")
export class PublicCampaignsController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly participation: ParticipationService,
  ) {}

  @Get(":id")
  get(@Param("id") id: string) {
    return this.campaigns.getPublicView(id);
  }

  @Get(":id/deliverables")
  getDeliverables(@Param("id") id: string) {
    return this.participation.getPublicDeliverables(id);
  }
}
