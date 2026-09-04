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
};

export type ChecklistItem = {
  id: string;
  label: string;
  source: "brief" | "doRules" | "avoidRules";
};

export type AutoReviewOutcome = {
  decision: "auto_approved" | "auto_rejected" | "needs_review";
  tier1Results: GateResult[];
  tier2Results: CriterionResult[] | null;
  modelVersion: string | null;
};
