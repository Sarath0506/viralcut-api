-- CreateEnum
CREATE TYPE "AutoReviewStage" AS ENUM ('draft', 'proof');

-- AlterTable
ALTER TABLE "auto_review_results" ADD COLUMN     "stage" "AutoReviewStage" NOT NULL DEFAULT 'proof';
