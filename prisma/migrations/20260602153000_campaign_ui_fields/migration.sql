ALTER TABLE "campaigns"
ADD COLUMN "platforms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "brief_hook" TEXT,
ADD COLUMN "product_focus" TEXT,
ADD COLUMN "tone_of_voice" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "do_rules" TEXT,
ADD COLUMN "avoid_rules" TEXT,
ADD COLUMN "reference_assets" JSONB,
ADD COLUMN "start_date" TIMESTAMP(3);

UPDATE "campaigns"
SET "platforms" = ARRAY["platform"]
WHERE "platform" IS NOT NULL;
