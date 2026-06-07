import { Injectable } from "@nestjs/common";

import { RealtimeGateway } from "./realtime.gateway";

@Injectable()
export class RealtimeService {
  constructor(private readonly gateway: RealtimeGateway) {}

  emitCampaignCreated(campaign: Record<string, unknown>): void {
    this.gateway.emitToAdmin("campaign:created", { campaign });
    const brandProfileId = campaign.brandProfileId as string | null | undefined;
    if (brandProfileId) {
      this.gateway.emitToBrand(brandProfileId, "campaign:created", { campaign });
    }
    this.gateway.emitToCampaign(campaign.id as string, "campaign:created", {
      campaign,
    });
  }

  emitCampaignUpdated(campaign: Record<string, unknown>): void {
    this.gateway.emitToAdmin("campaign:updated", { campaign });
    const brandProfileId = campaign.brandProfileId as string | null | undefined;
    if (brandProfileId) {
      this.gateway.emitToBrand(brandProfileId, "campaign:updated", { campaign });
    }
    this.gateway.emitToCampaign(campaign.id as string, "campaign:updated", {
      campaign,
    });
  }

  emitCampaignPublished(campaign: Record<string, unknown>): void {
    this.gateway.emitToAdmin("campaign:published", { campaign });
    const brandProfileId = campaign.brandProfileId as string | null | undefined;
    if (brandProfileId) {
      this.gateway.emitToBrand(brandProfileId, "campaign:published", {
        campaign,
      });
    }
    this.gateway.emitToCampaign(campaign.id as string, "campaign:published", {
      campaign,
    });
  }

  emitCampaignInviteSent(invite: Record<string, unknown>): void {
    this.gateway.emitToAdmin("campaignInvite:sent", { invite });
  }

  emitCampaignInviteAccepted(
    invite: Record<string, unknown>,
    campaign: Record<string, unknown>,
  ): void {
    this.gateway.emitToAdmin("campaignInvite:accepted", { invite, campaign });
    const brandProfileId = campaign.brandProfileId as string | null | undefined;
    if (brandProfileId) {
      this.gateway.emitToBrand(brandProfileId, "campaignInvite:accepted", {
        invite,
        campaign,
      });
    }
    this.gateway.emitToCampaign(campaign.id as string, "campaignInvite:accepted", {
      invite,
      campaign,
    });
  }
}
