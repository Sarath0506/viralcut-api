import { Injectable } from "@nestjs/common";

import { RealtimeGateway } from "./realtime.gateway";

export type DeliverableEventPayload = {
  deliverableId: string;
  participationId: string;
  campaignId: string;
  creatorId: string;
  brandProfileId: string | null;
  platform: string;
  status: string;
};

export type ParticipationJoinedPayload = {
  participationId: string;
  campaignId: string;
  creatorId: string;
  brandProfileId: string | null;
};

@Injectable()
export class RealtimeService {
  constructor(private readonly gateway: RealtimeGateway) {}

  private broadcastDeliverableToBrand(
    event: string,
    payload: DeliverableEventPayload,
  ): void {
    this.gateway.emitToAdmin(event, payload);
    if (payload.brandProfileId) {
      this.gateway.emitToBrand(payload.brandProfileId, event, payload);
    }
    this.gateway.emitToCampaign(payload.campaignId, event, payload);
  }

  emitDeliverableSubmitted(payload: DeliverableEventPayload): void {
    this.broadcastDeliverableToBrand("deliverable:submitted", payload);
  }

  emitDeliverableReviewed(payload: DeliverableEventPayload): void {
    this.gateway.emitToCreator(payload.creatorId, "deliverable:reviewed", payload);
    this.broadcastDeliverableToBrand("deliverable:reviewed", payload);
  }

  emitDeliverableLiveProof(payload: DeliverableEventPayload): void {
    this.broadcastDeliverableToBrand("deliverable:live_proof", payload);
    this.gateway.emitToCreator(payload.creatorId, "deliverable:live_proof", payload);
  }

  emitParticipationJoined(payload: ParticipationJoinedPayload): void {
    this.gateway.emitToAdmin("participation:joined", payload);
    if (payload.brandProfileId) {
      this.gateway.emitToBrand(
        payload.brandProfileId,
        "participation:joined",
        payload,
      );
    }
    this.gateway.emitToCampaign(payload.campaignId, "participation:joined", payload);
  }

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
