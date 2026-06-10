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
    this.gateway.emitToCreator(
      payload.creatorId,
      "deliverable:submitted",
      payload,
    );
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
    this.gateway.emitToCreator(
      payload.creatorId,
      "participation:joined",
      payload,
    );
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

  private broadcastCampaignEvent(
    event: string,
    campaign: Record<string, unknown>,
  ): void {
    const payload = { campaign };
    this.gateway.emitToAdmin(event, payload);
    this.gateway.emitToCreators(event, payload);
    const brandProfileId = campaign.brandProfileId as string | null | undefined;
    if (brandProfileId) {
      this.gateway.emitToBrand(brandProfileId, event, payload);
    }
    this.gateway.emitToCampaign(campaign.id as string, event, payload);
  }

  emitCampaignCreated(campaign: Record<string, unknown>): void {
    this.broadcastCampaignEvent("campaign:created", campaign);
  }

  emitCampaignUpdated(campaign: Record<string, unknown>): void {
    this.broadcastCampaignEvent("campaign:updated", campaign);
  }

  emitCampaignPublished(campaign: Record<string, unknown>): void {
    this.broadcastCampaignEvent("campaign:published", campaign);
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
