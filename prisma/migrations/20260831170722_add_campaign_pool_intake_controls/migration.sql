-- CreateEnum
CREATE TYPE "NewClipperIntakeStatus" AS ENUM ('open', 'closed_at_threshold', 'manually_extended');

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "allow_excess_views_to_fill_pool" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "extra_clipper_allowance" INTEGER,
ADD COLUMN     "new_clipper_intake_status" "NewClipperIntakeStatus" NOT NULL DEFAULT 'open',
ADD COLUMN     "pool_threshold_bps" INTEGER NOT NULL DEFAULT 8000;
