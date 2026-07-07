-- AlterTable
ALTER TABLE "creator_profiles" ADD COLUMN     "social_links" JSONB DEFAULT '{}',
ADD COLUMN     "social_stats" JSONB DEFAULT '{}';
