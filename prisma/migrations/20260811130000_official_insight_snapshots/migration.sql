-- CreateTable
CREATE TABLE "deliverable_insight_snapshots" (
    "id" TEXT NOT NULL,
    "deliverable_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "live_post_url" TEXT NOT NULL,
    "platform_media_id" TEXT,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "like_count" INTEGER NOT NULL DEFAULT 0,
    "comment_count" INTEGER NOT NULL DEFAULT 0,
    "share_count" INTEGER NOT NULL DEFAULT 0,
    "save_count" INTEGER NOT NULL DEFAULT 0,
    "watch_time_seconds" INTEGER NOT NULL DEFAULT 0,
    "average_view_duration_seconds" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'success',
    "error_code" TEXT,
    "raw_metrics" JSONB NOT NULL DEFAULT '{}',
    "collected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deliverable_insight_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_account_insight_snapshots" (
    "id" TEXT NOT NULL,
    "creator_profile_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "platform_user_id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "follower_count" INTEGER NOT NULL DEFAULT 0,
    "following_count" INTEGER NOT NULL DEFAULT 0,
    "media_count" INTEGER NOT NULL DEFAULT 0,
    "total_view_count" INTEGER NOT NULL DEFAULT 0,
    "engagement_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "raw_metrics" JSONB NOT NULL DEFAULT '{}',
    "source" TEXT NOT NULL,
    "collected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_account_insight_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deliverable_insight_snapshots_deliverable_id_collected_at_idx" ON "deliverable_insight_snapshots"("deliverable_id", "collected_at");

-- CreateIndex
CREATE INDEX "deliverable_insight_snapshots_platform_collected_at_idx" ON "deliverable_insight_snapshots"("platform", "collected_at");

-- CreateIndex
CREATE INDEX "social_account_insight_snapshots_creator_profile_id_platform_co" ON "social_account_insight_snapshots"("creator_profile_id", "platform", "collected_at");

-- CreateIndex
CREATE INDEX "social_account_insight_snapshots_platform_collected_at_idx" ON "social_account_insight_snapshots"("platform", "collected_at");

-- AddForeignKey
ALTER TABLE "deliverable_insight_snapshots" ADD CONSTRAINT "deliverable_insight_snapshots_deliverable_id_fkey" FOREIGN KEY ("deliverable_id") REFERENCES "format_deliverables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_account_insight_snapshots" ADD CONSTRAINT "social_account_insight_snapshots_creator_profile_id_fkey" FOREIGN KEY ("creator_profile_id") REFERENCES "creator_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
