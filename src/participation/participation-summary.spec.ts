import { CampaignStatus, FormatDeliverableStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  computeParticipationSummary,
  isParticipationCompleted,
  type DeliverableSnapshot,
} from "./participation-summary";

function d(
  status: FormatDeliverableStatus,
  draftDriveUrl: string | null = null,
  livePostUrl: string | null = null,
): DeliverableSnapshot {
  return { status, draftDriveUrl, livePostUrl };
}

describe("computeParticipationSummary", () => {
  it("returns closed when campaign is not live", () => {
    expect(
      computeParticipationSummary(
        [d(FormatDeliverableStatus.draft_pending)],
        CampaignStatus.paused,
      ),
    ).toBe("closed");
  });

  it("returns joined when all deliverables are draft_pending", () => {
    expect(
      computeParticipationSummary(
        [
          d(FormatDeliverableStatus.draft_pending),
          d(FormatDeliverableStatus.draft_pending),
        ],
        CampaignStatus.live,
      ),
    ).toBe("joined");
  });

  it("returns drafts_incomplete when only some platforms have drafts", () => {
    expect(
      computeParticipationSummary(
        [
          d(FormatDeliverableStatus.under_review, "https://drive.google.com/a"),
          d(FormatDeliverableStatus.draft_pending),
        ],
        CampaignStatus.live,
      ),
    ).toBe("drafts_incomplete");
  });

  it("returns in_review when any format is under_review and none rejected", () => {
    expect(
      computeParticipationSummary(
        [
          d(FormatDeliverableStatus.under_review, "https://drive.google.com/a"),
          d(FormatDeliverableStatus.under_review, "https://drive.google.com/b"),
        ],
        CampaignStatus.live,
      ),
    ).toBe("in_review");
  });

  it("returns action_required when any format is rejected", () => {
    expect(
      computeParticipationSummary(
        [
          d(
            FormatDeliverableStatus.draft_rejected,
            "https://drive.google.com/a",
            null,
          ),
          d(
            FormatDeliverableStatus.draft_approved,
            "https://drive.google.com/b",
            null,
          ),
        ],
        CampaignStatus.live,
      ),
    ).toBe("action_required");
  });

  it("returns action_required when live proof exists but another format is rejected", () => {
    expect(
      computeParticipationSummary(
        [
          d(
            FormatDeliverableStatus.live_submitted,
            "https://drive.google.com/a",
            "https://instagram.com/reel/1",
          ),
          d(
            FormatDeliverableStatus.draft_rejected,
            "https://drive.google.com/b",
            null,
          ),
        ],
        CampaignStatus.live,
      ),
    ).toBe("action_required");
  });

  it("returns action_required when approved format lacks live proof", () => {
    expect(
      computeParticipationSummary(
        [
          d(
            FormatDeliverableStatus.draft_approved,
            "https://drive.google.com/a",
            null,
          ),
        ],
        CampaignStatus.live,
      ),
    ).toBe("action_required");
  });

  it("returns proof_complete only when all formats have live proof", () => {
    expect(
      computeParticipationSummary(
        [
          d(
            FormatDeliverableStatus.live_submitted,
            "https://drive.google.com/a",
            "https://instagram.com/reel/1",
          ),
          d(
            FormatDeliverableStatus.live_submitted,
            "https://drive.google.com/b",
            "https://youtube.com/shorts/1",
          ),
        ],
        CampaignStatus.live,
      ),
    ).toBe("proof_complete");
  });

  it("returns action_required when all formats are rejected", () => {
    expect(
      computeParticipationSummary(
        [
          d(
            FormatDeliverableStatus.draft_rejected,
            "https://drive.google.com/a",
          ),
          d(
            FormatDeliverableStatus.draft_rejected,
            "https://drive.google.com/b",
          ),
        ],
        CampaignStatus.live,
      ),
    ).toBe("action_required");
  });
});

describe("isParticipationCompleted", () => {
  it("marks proof_complete and closed as completed", () => {
    expect(isParticipationCompleted("proof_complete")).toBe(true);
    expect(isParticipationCompleted("closed")).toBe(true);
    expect(isParticipationCompleted("in_review")).toBe(false);
    expect(isParticipationCompleted("action_required")).toBe(false);
  });
});