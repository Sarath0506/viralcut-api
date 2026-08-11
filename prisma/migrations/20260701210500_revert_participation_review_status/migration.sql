-- DropForeignKey
ALTER TABLE "campaign_participations" DROP CONSTRAINT "campaign_participations_reviewed_by_user_id_fkey";

-- AlterTable
ALTER TABLE "campaign_participations" DROP COLUMN "rejection_reason",
DROP COLUMN "reviewed_at",
DROP COLUMN "reviewed_by_user_id",
DROP COLUMN "status";

-- DropEnum
DROP TYPE "ParticipationStatus";
