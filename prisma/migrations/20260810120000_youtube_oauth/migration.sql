CREATE TABLE "youtube_connections" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "creator_profile_id" TEXT NOT NULL,
  "platform_user_id" TEXT NOT NULL,
  "platform_handle" TEXT NOT NULL,
  "encrypted_access_token" TEXT NOT NULL,
  "encrypted_refresh_token" TEXT,
  "token_expires_at" TIMESTAMP(3),
  "subscriber_count" INTEGER NOT NULL DEFAULT 0,
  "video_count" INTEGER NOT NULL DEFAULT 0,
  "total_view_count" INTEGER NOT NULL DEFAULT 0,
  "engagement_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "profile_picture_url" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "is_connected" BOOLEAN NOT NULL DEFAULT true,
  "last_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "youtube_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "youtube_connections_creator_profile_id_key" ON "youtube_connections"("creator_profile_id");
CREATE INDEX "youtube_connections_user_id_idx" ON "youtube_connections"("user_id");
CREATE INDEX "youtube_connections_platform_user_id_idx" ON "youtube_connections"("platform_user_id");

ALTER TABLE "youtube_connections"
  ADD CONSTRAINT "youtube_connections_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "youtube_connections"
  ADD CONSTRAINT "youtube_connections_creator_profile_id_fkey"
  FOREIGN KEY ("creator_profile_id") REFERENCES "creator_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
