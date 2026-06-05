-- Campaign platform ID rename (instagram_reels -> instagram_reel)
UPDATE "campaigns"
SET "platform" = 'instagram_reel'
WHERE "platform" = 'instagram_reels';

UPDATE "campaigns"
SET "platforms" = (
  SELECT COALESCE(array_agg(
    CASE WHEN elem = 'instagram_reels' THEN 'instagram_reel' ELSE elem END
  ), '{}')
  FROM unnest("platforms") AS elem
)
WHERE 'instagram_reels' = ANY("platforms");

ALTER TABLE "campaigns" ALTER COLUMN "platform" SET DEFAULT 'instagram_reel';

-- Source assets for brand-provided Drive / YouTube links
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "source_assets" JSONB;

-- Remove deprecated campaign fields
ALTER TABLE "campaigns" DROP COLUMN IF EXISTS "product_focus";
ALTER TABLE "campaigns" DROP COLUMN IF EXISTS "tone_of_voice";
ALTER TABLE "campaigns" DROP COLUMN IF EXISTS "ends_at";

-- Remove creator tier profiles (creators identified via users.role only)
DROP TABLE IF EXISTS "creator_profiles";
