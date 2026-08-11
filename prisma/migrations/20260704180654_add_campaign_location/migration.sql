-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "location_type" TEXT NOT NULL DEFAULT 'pan_india',
ADD COLUMN     "target_states" TEXT[] DEFAULT ARRAY[]::TEXT[];
