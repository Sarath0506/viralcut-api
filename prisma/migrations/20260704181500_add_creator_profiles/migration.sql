-- CreateTable
CREATE TABLE "creator_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "label" TEXT,
    "avatar_url" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creator_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "creator_profiles_user_id_idx" ON "creator_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "creator_profiles_user_id_platform_handle_key" ON "creator_profiles"("user_id", "platform", "handle");

-- AddForeignKey
ALTER TABLE "creator_profiles" ADD CONSTRAINT "creator_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: one default profile per user who has already joined at least one campaign.
-- Every legacy participation collapses onto this single profile, so the new
-- (campaign_id, creator_profile_id) uniqueness is trivially satisfied for existing rows.
INSERT INTO "creator_profiles" ("id", "user_id", "platform", "handle", "is_default", "created_at")
SELECT
  'legacy-' || u."id",
  u."id",
  COALESCE((SELECT key FROM jsonb_each_text(u."social_links"::jsonb) LIMIT 1), 'instagram'),
  COALESCE(u."username", u."display_name", 'creator'),
  true,
  now()
FROM "users" u
WHERE EXISTS (SELECT 1 FROM "campaign_participations" cp WHERE cp."creator_id" = u."id");

-- AlterTable
ALTER TABLE "campaign_participations" ADD COLUMN "creator_profile_id" TEXT;

UPDATE "campaign_participations" cp
SET "creator_profile_id" = p."id"
FROM "creator_profiles" p
WHERE p."user_id" = cp."creator_id" AND p."is_default" = true;

ALTER TABLE "campaign_participations" ALTER COLUMN "creator_profile_id" SET NOT NULL;

-- DropIndex
DROP INDEX "campaign_participations_campaign_id_creator_id_key";

-- CreateIndex
CREATE INDEX "campaign_participations_creator_profile_id_idx" ON "campaign_participations"("creator_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_participations_campaign_id_creator_profile_id_key" ON "campaign_participations"("campaign_id", "creator_profile_id");

-- AddForeignKey
ALTER TABLE "campaign_participations" ADD CONSTRAINT "campaign_participations_creator_profile_id_fkey" FOREIGN KEY ("creator_profile_id") REFERENCES "creator_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
