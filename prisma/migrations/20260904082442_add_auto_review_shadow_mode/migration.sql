-- CreateEnum
CREATE TYPE "AutoReviewDecision" AS ENUM ('auto_approved', 'auto_rejected', 'needs_review');

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "compliance_checklist" JSONB;

-- CreateTable
CREATE TABLE "auto_review_results" (
    "id" TEXT NOT NULL,
    "deliverable_id" TEXT NOT NULL,
    "decision" "AutoReviewDecision" NOT NULL,
    "tier1_results" JSONB NOT NULL,
    "tier2_results" JSONB,
    "model_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auto_review_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auto_review_results_deliverable_id_created_at_idx" ON "auto_review_results"("deliverable_id", "created_at");

-- AddForeignKey
ALTER TABLE "auto_review_results" ADD CONSTRAINT "auto_review_results_deliverable_id_fkey" FOREIGN KEY ("deliverable_id") REFERENCES "format_deliverables"("id") ON DELETE CASCADE ON UPDATE CASCADE;
