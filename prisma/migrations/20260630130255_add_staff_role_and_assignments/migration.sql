-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'staff';

-- CreateTable
CREATE TABLE "staff_brand_assignments" (
    "id" TEXT NOT NULL,
    "staff_user_id" TEXT NOT NULL,
    "brand_profile_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_brand_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_brand_assignments_staff_user_id_idx" ON "staff_brand_assignments"("staff_user_id");

-- CreateIndex
CREATE INDEX "staff_brand_assignments_brand_profile_id_idx" ON "staff_brand_assignments"("brand_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_brand_assignments_staff_user_id_brand_profile_id_key" ON "staff_brand_assignments"("staff_user_id", "brand_profile_id");

-- AddForeignKey
ALTER TABLE "staff_brand_assignments" ADD CONSTRAINT "staff_brand_assignments_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_brand_assignments" ADD CONSTRAINT "staff_brand_assignments_brand_profile_id_fkey" FOREIGN KEY ("brand_profile_id") REFERENCES "brand_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
