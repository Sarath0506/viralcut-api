import { beforeEach, describe, expect, it, vi } from "vitest";

import { RealtimeService } from "./realtime.service";

function makeGateway() {
  return {
    emitToAdmin: vi.fn(),
    emitToBrand: vi.fn(),
    emitToCampaign: vi.fn(),
    emitToCreator: vi.fn(),
    emitToCreators: vi.fn(),
  };
}

describe("RealtimeService deliverable events", () => {
  let gateway: ReturnType<typeof makeGateway>;
  let service: RealtimeService;

  const payload = {
    deliverableId: "d1",
    participationId: "part-1",
    campaignId: "camp-1",
    creatorId: "creator-1",
    brandProfileId: "brand-1",
    platform: "instagram_reel",
    status: "under_review",
  };

  beforeEach(() => {
    gateway = makeGateway();
    service = new RealtimeService(gateway as never);
  });

  it("emitDeliverableSubmitted notifies creator, admin, brand, and campaign room", () => {
    service.emitDeliverableSubmitted(payload);
    expect(gateway.emitToCreator).toHaveBeenCalledWith(
      "creator-1",
      "deliverable:submitted",
      payload,
    );
    expect(gateway.emitToAdmin).toHaveBeenCalledWith(
      "deliverable:submitted",
      payload,
    );
    expect(gateway.emitToBrand).toHaveBeenCalledWith(
      "brand-1",
      "deliverable:submitted",
      payload,
    );
    expect(gateway.emitToCampaign).toHaveBeenCalledWith(
      "camp-1",
      "deliverable:submitted",
      payload,
    );
  });

  it("emitDeliverableReviewed notifies creator and brand", () => {
    service.emitDeliverableReviewed({
      ...payload,
      status: "draft_approved",
    });
    expect(gateway.emitToCreator).toHaveBeenCalledWith(
      "creator-1",
      "deliverable:reviewed",
      expect.objectContaining({ status: "draft_approved" }),
    );
    expect(gateway.emitToBrand).toHaveBeenCalled();
  });

  it("emitCampaignPublished notifies creators marketplace room", () => {
    const campaign = { id: "camp-1", brandProfileId: "brand-1", title: "Test" };
    service.emitCampaignPublished(campaign);
    expect(gateway.emitToCreators).toHaveBeenCalledWith("campaign:published", {
      campaign,
    });
    expect(gateway.emitToCampaign).toHaveBeenCalledWith(
      "camp-1",
      "campaign:published",
      { campaign },
    );
  });

  it("emitDeliverableLiveProof notifies creator and brand", () => {
    service.emitDeliverableLiveProof({
      ...payload,
      status: "live_submitted",
    });
    expect(gateway.emitToCreator).toHaveBeenCalledWith(
      "creator-1",
      "deliverable:live_proof",
      expect.objectContaining({ status: "live_submitted" }),
    );
    expect(gateway.emitToAdmin).toHaveBeenCalled();
  });
});
