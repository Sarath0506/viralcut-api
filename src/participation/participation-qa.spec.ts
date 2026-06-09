import { CampaignStatus, FormatDeliverableStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  computeParticipationSummary,
  isParticipationCompleted,
} from "./participation-summary";

/**
 * QA matrix from multi-format plan — automated checks for edge-case summaries.
 */
describe("Participation QA edge cases", () => {
  it("partial approve/reject: IG rejected + YT approved without live = action_required", () => {
    const summary = computeParticipationSummary(
      [
        {
          status: FormatDeliverableStatus.draft_rejected,
          draftDriveUrl: "https://drive.google.com/a",
          livePostUrl: null,
        },
        {
          status: FormatDeliverableStatus.draft_approved,
          draftDriveUrl: "https://drive.google.com/b",
          livePostUrl: null,
        },
      ],
      CampaignStatus.live,
    );
    expect(summary).toBe("action_required");
  });

  it("partial approve: IG live_submitted + YT rejected = proof_complete", () => {
    const summary = computeParticipationSummary(
      [
        {
          status: FormatDeliverableStatus.live_submitted,
          draftDriveUrl: "https://drive.google.com/a",
          livePostUrl: "https://instagram.com/reel/1",
        },
        {
          status: FormatDeliverableStatus.draft_rejected,
          draftDriveUrl: "https://drive.google.com/b",
          livePostUrl: null,
        },
      ],
      CampaignStatus.live,
    );
    expect(summary).toBe("proof_complete");
    expect(isParticipationCompleted(summary)).toBe(true);
  });

  it("all platforms rejected moves to completed tab", () => {
    const summary = computeParticipationSummary(
      [
        {
          status: FormatDeliverableStatus.draft_rejected,
          draftDriveUrl: "https://drive.google.com/a",
          livePostUrl: null,
        },
        {
          status: FormatDeliverableStatus.draft_rejected,
          draftDriveUrl: "https://drive.google.com/b",
          livePostUrl: null,
        },
      ],
      CampaignStatus.live,
    );
    expect(summary).toBe("proof_complete");
    expect(isParticipationCompleted(summary)).toBe(true);
  });

  it("closed campaign after join yields closed summary", () => {
    const summary = computeParticipationSummary(
      [
        {
          status: FormatDeliverableStatus.under_review,
          draftDriveUrl: "https://drive.google.com/a",
          livePostUrl: null,
        },
      ],
      CampaignStatus.paused,
    );
    expect(summary).toBe("closed");
    expect(isParticipationCompleted(summary)).toBe(true);
  });

  it("only 2 of 3 drive links = drafts_incomplete", () => {
    const summary = computeParticipationSummary(
      [
        {
          status: FormatDeliverableStatus.under_review,
          draftDriveUrl: "https://drive.google.com/a",
          livePostUrl: null,
        },
        {
          status: FormatDeliverableStatus.under_review,
          draftDriveUrl: "https://drive.google.com/b",
          livePostUrl: null,
        },
        {
          status: FormatDeliverableStatus.draft_pending,
          draftDriveUrl: null,
          livePostUrl: null,
        },
      ],
      CampaignStatus.live,
    );
    expect(summary).toBe("drafts_incomplete");
  });
});
