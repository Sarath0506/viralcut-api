export type GateStatus = "pass" | "fail" | "unresolved";

export type GateResult = {
  gate: string;
  status: GateStatus;
  reason: string;
};

export type CriterionResult = {
  criterionId: string;
  label: string;
  pass: boolean;
  confidence: number;
  reason: string;
  /** Whether this check gates the auto-review decision. False only for a
   * source_video_match/source_audio_match item created while that
   * requirement is set to "optional" — still evaluated and shown to a
   * reviewer, but a fail here never causes an auto_rejected/needs_review
   * outcome. Always true for brief/doRules/avoidRules-derived items. */
  required: boolean;
};

export type ChecklistItem = {
  id: string;
  label: string;
  source: "brief" | "doRules" | "avoidRules" | "sourceVideo" | "sourceAudio";
  /** Defaults to true when absent — only set explicitly false for a
   * source_video_match/source_audio_match item when the campaign's
   * corresponding requirement is "optional". */
  required?: boolean;
};

export type AutoReviewOutcome = {
  decision: "auto_approved" | "auto_rejected" | "needs_review";
  tier1Results: GateResult[];
  tier2Results: CriterionResult[] | null;
  modelVersion: string | null;
};
