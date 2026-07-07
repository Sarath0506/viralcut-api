-- CreateEnum
CREATE TYPE "ParticipationStatus" AS ENUM ('active', 'rejected');

-- AlterTable
ALTER TABLE "campaign_participations" ADD COLUMN     "rejection_reason" TEXT,
ADD COLUMN     "reviewed_at" TIMESTAMP(3),
ADD COLUMN     "reviewed_by_user_id" TEXT,
ADD COLUMN     "status" "ParticipationStatus" NOT NULL DEFAULT 'active';

-- AddForeignKey
ALTER TABLE "campaign_participations" ADD CONSTRAINT "campaign_participations_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
