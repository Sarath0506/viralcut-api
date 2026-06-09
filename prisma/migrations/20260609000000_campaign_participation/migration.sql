-- CreateEnum
CREATE TYPE "FormatDeliverableStatus" AS ENUM ('draft_pending', 'under_review', 'draft_rejected', 'draft_approved', 'live_submitted');

-- CreateTable
CREATE TABLE "campaign_participations" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "creator_id" TEXT NOT NULL,
    "platforms_snapshot" TEXT[],
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_participations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "format_deliverables" (
    "id" TEXT NOT NULL,
    "participation_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "draft_drive_url" TEXT,
    "live_post_url" TEXT,
    "status" "FormatDeliverableStatus" NOT NULL DEFAULT 'draft_pending',
    "rejection_reason" TEXT,
    "draft_submitted_at" TIMESTAMP(3),
    "draft_reviewed_at" TIMESTAMP(3),
    "live_submitted_at" TIMESTAMP(3),
    "reviewed_by_user_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "format_deliverables_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaign_participations_creator_id_idx" ON "campaign_participations"("creator_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_participations_campaign_id_creator_id_key" ON "campaign_participations"("campaign_id", "creator_id");

-- CreateIndex
CREATE INDEX "format_deliverables_participation_id_idx" ON "format_deliverables"("participation_id");

-- CreateIndex
CREATE INDEX "format_deliverables_status_idx" ON "format_deliverables"("status");

-- CreateIndex
CREATE UNIQUE INDEX "format_deliverables_participation_id_platform_key" ON "format_deliverables"("participation_id", "platform");

-- AddForeignKey
ALTER TABLE "campaign_participations" ADD CONSTRAINT "campaign_participations_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_participations" ADD CONSTRAINT "campaign_participations_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "format_deliverables" ADD CONSTRAINT "format_deliverables_participation_id_fkey" FOREIGN KEY ("participation_id") REFERENCES "campaign_participations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "format_deliverables" ADD CONSTRAINT "format_deliverables_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
