-- CreateEnum
CREATE TYPE "AdminSection" AS ENUM ('dashboard', 'brands', 'clippers', 'campaigns', 'analytics', 'tickets', 'faqs', 'notifications', 'team');

-- CreateEnum
CREATE TYPE "AdminPermissionLevel" AS ENUM ('hidden', 'view', 'manage');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "admin_role_id" TEXT;

-- CreateTable
CREATE TABLE "admin_roles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "can_see_money" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_section_permissions" (
    "id" TEXT NOT NULL,
    "admin_role_id" TEXT NOT NULL,
    "section" "AdminSection" NOT NULL,
    "level" "AdminPermissionLevel" NOT NULL DEFAULT 'hidden',

    CONSTRAINT "admin_section_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_roles_name_key" ON "admin_roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "admin_section_permissions_admin_role_id_section_key" ON "admin_section_permissions"("admin_role_id", "section");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_admin_role_id_fkey" FOREIGN KEY ("admin_role_id") REFERENCES "admin_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_section_permissions" ADD CONSTRAINT "admin_section_permissions_admin_role_id_fkey" FOREIGN KEY ("admin_role_id") REFERENCES "admin_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
