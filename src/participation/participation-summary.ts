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
  if (campaignStatus === CampaignStatus.closed) {
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

  const proofSubmittedStatuses = [
    FormatDeliverableStatus.live_submitted,
    FormatDeliverableStatus.proof_under_review,
    FormatDeliverableStatus.proof_approved,
  ] as string[];

  const allProofSubmitted = deliverables.every((d) => proofSubmittedStatuses.includes(d.status));
  if (allProofSubmitted) {
    // Submitting live proof isn't the finish line — a human (or auto-review)
    // still has to approve it. Only every deliverable actually reaching
    // proof_approved counts as complete; live_submitted/proof_under_review
    // means proof is in, not proof is done.
    const allProofApproved = deliverables.every(
      (d) => d.status === FormatDeliverableStatus.proof_approved,
    );
    return allProofApproved ? "proof_complete" : "in_review";
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
