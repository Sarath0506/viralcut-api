-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FormatDeliverableStatus" ADD VALUE 'proof_under_review';
ALTER TYPE "FormatDeliverableStatus" ADD VALUE 'proof_approved';
ALTER TYPE "FormatDeliverableStatus" ADD VALUE 'proof_rejected';

-- AlterTable
ALTER TABLE "format_deliverables" ADD COLUMN     "proof_reviewed_at" TIMESTAMP(3),
ADD COLUMN     "view_count" INTEGER NOT NULL DEFAULT 0;
