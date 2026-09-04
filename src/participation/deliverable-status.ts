import { FormatDeliverableStatus } from "@prisma/client";

/** A deliverable slot with no accepted content yet — open for a fresh draft
 * submission, or for a marketplace repost to claim. */
export const FILLABLE_DELIVERABLE_STATUSES: FormatDeliverableStatus[] = [
  FormatDeliverableStatus.draft_pending,
  FormatDeliverableStatus.draft_rejected,
];
