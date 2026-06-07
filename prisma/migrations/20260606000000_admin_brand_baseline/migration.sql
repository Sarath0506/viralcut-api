-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('creator', 'brand', 'admin');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('not_started', 'pending', 'verified', 'rejected');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'live', 'paused', 'closed');

-- CreateEnum
CREATE TYPE "CampaignWizardStep" AS ENUM ('basics', 'brief', 'payout', 'review');

-- CreateEnum
CREATE TYPE "CampaignOwnership" AS ENUM ('brand_created', 'admin_created');

-- CreateEnum
CREATE TYPE "CampaignInviteStatus" AS ENUM ('pending', 'accepted', 'expired', 'revoked');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('draft_submitted', 'under_review', 'approved', 'awaiting_live_link', 'live_tracking', 'payout_pending', 'paid', 'rejected');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('earning_credit', 'withdrawal_debit', 'fee_debit', 'adjustment');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "password_hash" TEXT,
    "display_name" TEXT,
    "username" TEXT,
    "fixed_otp_code" VARCHAR(6),
    "kyc_status" "KycStatus" NOT NULL DEFAULT 'not_started',
    "terms_accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_sessions" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "logo_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "brand_profile_id" TEXT,
    "created_by_user_id" TEXT,
    "ownership" "CampaignOwnership" NOT NULL DEFAULT 'brand_created',
    "wizard_step" "CampaignWizardStep" NOT NULL DEFAULT 'basics',
    "invite_accepted_at" TIMESTAMP(3),
    "title" TEXT NOT NULL,
    "category" TEXT,
    "platform" TEXT NOT NULL DEFAULT 'instagram_reel',
    "platforms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "CampaignStatus" NOT NULL DEFAULT 'draft',
    "brief" TEXT NOT NULL,
    "brief_hook" TEXT,
    "do_rules" TEXT,
    "avoid_rules" TEXT,
    "source_assets" JSONB,
    "reference_assets" JSONB,
    "cover_image_url" TEXT,
    "product_url" TEXT,
    "rate_per_1k_paise" INTEGER NOT NULL,
    "max_payout_paise" INTEGER NOT NULL,
    "budget_paise" INTEGER NOT NULL,
    "budget_used_paise" INTEGER NOT NULL DEFAULT 0,
    "start_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_invites" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" "CampaignInviteStatus" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "invited_by_user_id" TEXT NOT NULL,
    "accepted_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "creator_id" TEXT NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'draft_submitted',
    "media_type" TEXT NOT NULL DEFAULT 'video',
    "draft_drive_url" TEXT,
    "draft_storage_key" TEXT,
    "live_reel_url" TEXT,
    "eligible_views" INTEGER NOT NULL DEFAULT 0,
    "estimated_paise" INTEGER NOT NULL DEFAULT 0,
    "rejection_reason" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMP(3),
    "live_link_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "available_paise" INTEGER NOT NULL DEFAULT 0,
    "pending_paise" INTEGER NOT NULL DEFAULT 0,
    "lifetime_paise" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "reference_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_methods" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "account_masked" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "fee_paise" INTEGER NOT NULL,
    "net_paise" INTEGER NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'pending',
    "payout_method_id" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "otp_sessions_phone_expires_at_idx" ON "otp_sessions"("phone", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "brand_profiles_user_id_key" ON "brand_profiles"("user_id");

-- CreateIndex
CREATE INDEX "campaigns_status_idx" ON "campaigns"("status");

-- CreateIndex
CREATE INDEX "campaigns_brand_profile_id_idx" ON "campaigns"("brand_profile_id");

-- CreateIndex
CREATE INDEX "campaigns_ownership_idx" ON "campaigns"("ownership");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_invites_token_hash_key" ON "campaign_invites"("token_hash");

-- CreateIndex
CREATE INDEX "campaign_invites_campaign_id_status_idx" ON "campaign_invites"("campaign_id", "status");

-- CreateIndex
CREATE INDEX "campaign_invites_email_idx" ON "campaign_invites"("email");

-- CreateIndex
CREATE INDEX "submissions_creator_id_status_idx" ON "submissions"("creator_id", "status");

-- CreateIndex
CREATE INDEX "submissions_campaign_id_status_idx" ON "submissions"("campaign_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_user_id_key" ON "wallets"("user_id");

-- CreateIndex
CREATE INDEX "transactions_wallet_id_created_at_idx" ON "transactions"("wallet_id", "created_at");

-- CreateIndex
CREATE INDEX "payout_methods_user_id_idx" ON "payout_methods"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_idempotency_key_key" ON "withdrawals"("idempotency_key");

-- CreateIndex
CREATE INDEX "withdrawals_user_id_status_idx" ON "withdrawals"("user_id", "status");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_profiles" ADD CONSTRAINT "brand_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_brand_profile_id_fkey" FOREIGN KEY ("brand_profile_id") REFERENCES "brand_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_invites" ADD CONSTRAINT "campaign_invites_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_invites" ADD CONSTRAINT "campaign_invites_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_invites" ADD CONSTRAINT "campaign_invites_accepted_by_user_id_fkey" FOREIGN KEY ("accepted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_methods" ADD CONSTRAINT "payout_methods_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

