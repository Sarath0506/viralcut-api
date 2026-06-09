import { CampaignStatus, FormatDeliverableStatus } from "@prisma/client";

export type ParticipationSummary =
  | "joined"
  | "drafts_incomplete"
  | "in_review"
  | "action_required"
  | "proof_complete"
  | "closed";

export type DeliverableSnapshot = {
  status: FormatDeliverableStatus;
  draftDriveUrl: string | null;
  livePostUrl: string | null;
};

export function computeParticipationSummary(
  deliverables: DeliverableSnapshot[],
  campaignStatus: CampaignStatus,
): ParticipationSummary {
  if (campaignStatus !== CampaignStatus.live) {
    return "closed";
  }

  if (deliverables.length === 0) {
    return "joined";
  }

  const allDraftPending = deliverables.every(
    (d) => d.status === FormatDeliverableStatus.draft_pending,
  );
  if (allDraftPending) {
    return "joined";
  }

  const withDraft = deliverables.filter((d) => d.draftDriveUrl?.trim());
  if (withDraft.length > 0 && withDraft.length < deliverables.length) {
    return "drafts_incomplete";
  }

  const allRejected = deliverables.every(
    (d) => d.status === FormatDeliverableStatus.draft_rejected,
  );
  if (allRejected) {
    return "proof_complete";
  }

  const approvedOrLive = deliverables.filter(
    (d) =>
      d.status === FormatDeliverableStatus.draft_approved ||
      d.status === FormatDeliverableStatus.live_submitted,
  );
  const allApprovedHaveLive =
    approvedOrLive.length > 0 &&
    approvedOrLive.every(
      (d) => d.status === FormatDeliverableStatus.live_submitted,
    );
  if (allApprovedHaveLive) {
    return "proof_complete";
  }

  const hasRejected = deliverables.some(
    (d) => d.status === FormatDeliverableStatus.draft_rejected,
  );
  const needsLiveProof = deliverables.some(
    (d) =>
      d.status === FormatDeliverableStatus.draft_approved &&
      !d.livePostUrl?.trim(),
  );
  if (hasRejected || needsLiveProof) {
    return "action_required";
  }

  const hasUnderReview = deliverables.some(
    (d) => d.status === FormatDeliverableStatus.under_review,
  );
  if (hasUnderReview) {
    return "in_review";
  }

  return "action_required";
}

export function isParticipationCompleted(summary: ParticipationSummary): boolean {
  return summary === "proof_complete" || summary === "closed";
}
