-- AlterTable
ALTER TABLE "users" ADD COLUMN "verified_creator_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_verified_creator_id_key" ON "users"("verified_creator_id");
