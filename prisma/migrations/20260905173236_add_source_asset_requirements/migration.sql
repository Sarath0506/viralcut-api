-- CreateEnum
CREATE TYPE "SourceAssetRequirement" AS ENUM ('mandatory', 'optional', 'not_required');

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "source_audio_requirement" "SourceAssetRequirement" NOT NULL DEFAULT 'not_required',
ADD COLUMN     "source_video_requirement" "SourceAssetRequirement" NOT NULL DEFAULT 'mandatory';
