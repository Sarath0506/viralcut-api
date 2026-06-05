-- CreateEnum
CREATE TYPE "AgencyBrandStatus" AS ENUM ('active', 'revoked');
CREATE TYPE "BrandMembershipRole" AS ENUM ('owner', 'manager', 'viewer');
CREATE TYPE "AgencyMembershipRole" AS ENUM ('owner', 'manager', 'viewer');
CREATE TYPE "BrandInviteStatus" AS ENUM ('pending', 'accepted', 'expired', 'revoked');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'agency';

-- AlterTable brand_profiles: optional user, logo, updated_at
ALTER TABLE "brand_profiles" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "brand_profiles" ADD COLUMN "logo_url" TEXT;
ALTER TABLE "brand_profiles" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable agencies
CREATE TABLE "agencies" (
    "id" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agencies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agency_memberships" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "AgencyMembershipRole" NOT NULL DEFAULT 'owner',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agency_memberships_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agency_brands" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "brand_profile_id" TEXT NOT NULL,
    "status" "AgencyBrandStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agency_brands_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "brand_memberships" (
    "id" TEXT NOT NULL,
    "brand_profile_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "BrandMembershipRole" NOT NULL DEFAULT 'owner',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "brand_memberships_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "brand_invites" (
    "id" TEXT NOT NULL,
    "brand_profile_id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" "BrandInviteStatus" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "invited_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "brand_invites_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "campaigns" ADD COLUMN "created_by_user_id" TEXT;

-- Backfill brand memberships for existing profiles with owners
INSERT INTO "brand_memberships" ("id", "brand_profile_id", "user_id", "role", "created_at")
SELECT
    'bm_' || "id",
    "id",
    "user_id",
    'owner'::"BrandMembershipRole",
    "created_at"
FROM "brand_profiles"
WHERE "user_id" IS NOT NULL
ON CONFLICT DO NOTHING;

-- CreateIndex
CREATE UNIQUE INDEX "agency_memberships_agency_id_user_id_key" ON "agency_memberships"("agency_id", "user_id");
CREATE INDEX "agency_memberships_user_id_idx" ON "agency_memberships"("user_id");

CREATE UNIQUE INDEX "agency_brands_brand_profile_id_key" ON "agency_brands"("brand_profile_id");
CREATE INDEX "agency_brands_agency_id_status_idx" ON "agency_brands"("agency_id", "status");

CREATE UNIQUE INDEX "brand_memberships_brand_profile_id_user_id_key" ON "brand_memberships"("brand_profile_id", "user_id");
CREATE INDEX "brand_memberships_user_id_idx" ON "brand_memberships"("user_id");

CREATE UNIQUE INDEX "brand_invites_token_hash_key" ON "brand_invites"("token_hash");
CREATE INDEX "brand_invites_brand_profile_id_status_idx" ON "brand_invites"("brand_profile_id", "status");
CREATE INDEX "brand_invites_email_idx" ON "brand_invites"("email");

-- AddForeignKey
ALTER TABLE "agency_memberships" ADD CONSTRAINT "agency_memberships_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agency_memberships" ADD CONSTRAINT "agency_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agency_brands" ADD CONSTRAINT "agency_brands_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agency_brands" ADD CONSTRAINT "agency_brands_brand_profile_id_fkey" FOREIGN KEY ("brand_profile_id") REFERENCES "brand_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "brand_memberships" ADD CONSTRAINT "brand_memberships_brand_profile_id_fkey" FOREIGN KEY ("brand_profile_id") REFERENCES "brand_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "brand_memberships" ADD CONSTRAINT "brand_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "brand_invites" ADD CONSTRAINT "brand_invites_brand_profile_id_fkey" FOREIGN KEY ("brand_profile_id") REFERENCES "brand_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "brand_invites" ADD CONSTRAINT "brand_invites_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "brand_invites" ADD CONSTRAINT "brand_invites_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "brand_profiles" DROP CONSTRAINT IF EXISTS "brand_profiles_user_id_fkey";
ALTER TABLE "brand_profiles" ADD CONSTRAINT "brand_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
