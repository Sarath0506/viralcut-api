CREATE TABLE "instagram_oauth_transactions" (
  "id" TEXT NOT NULL,
  "transaction_id" TEXT NOT NULL,
  "state_hash" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "creator_profile_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'started',
  "encrypted_access_token" TEXT,
  "token_expires_at" TIMESTAMP(3),
  "data_access_expires_at" TIMESTAMP(3),
  "error_code" TEXT,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "instagram_oauth_transactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "instagram_connections" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "creator_profile_id" TEXT NOT NULL,
  "platform_user_id" TEXT NOT NULL,
  "platform_handle" TEXT NOT NULL,
  "encrypted_access_token" TEXT NOT NULL,
  "token_expires_at" TIMESTAMP(3),
  "data_access_expires_at" TIMESTAMP(3),
  "follower_count" INTEGER NOT NULL DEFAULT 0,
  "follows_count" INTEGER NOT NULL DEFAULT 0,
  "media_count" INTEGER NOT NULL DEFAULT 0,
  "engagement_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "profile_picture_url" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "is_connected" BOOLEAN NOT NULL DEFAULT true,
  "last_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "instagram_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "instagram_oauth_transactions_transaction_id_key" ON "instagram_oauth_transactions"("transaction_id");
CREATE UNIQUE INDEX "instagram_oauth_transactions_state_hash_key" ON "instagram_oauth_transactions"("state_hash");
CREATE INDEX "instagram_oauth_transactions_user_id_idx" ON "instagram_oauth_transactions"("user_id");
CREATE INDEX "instagram_oauth_transactions_creator_profile_id_idx" ON "instagram_oauth_transactions"("creator_profile_id");
CREATE INDEX "instagram_oauth_transactions_expires_at_idx" ON "instagram_oauth_transactions"("expires_at");

CREATE UNIQUE INDEX "instagram_connections_creator_profile_id_key" ON "instagram_connections"("creator_profile_id");
CREATE INDEX "instagram_connections_user_id_idx" ON "instagram_connections"("user_id");
CREATE INDEX "instagram_connections_platform_user_id_idx" ON "instagram_connections"("platform_user_id");

ALTER TABLE "instagram_oauth_transactions"
  ADD CONSTRAINT "instagram_oauth_transactions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "instagram_oauth_transactions"
  ADD CONSTRAINT "instagram_oauth_transactions_creator_profile_id_fkey"
  FOREIGN KEY ("creator_profile_id") REFERENCES "creator_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "instagram_connections"
  ADD CONSTRAINT "instagram_connections_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "instagram_connections"
  ADD CONSTRAINT "instagram_connections_creator_profile_id_fkey"
  FOREIGN KEY ("creator_profile_id") REFERENCES "creator_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
