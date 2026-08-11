-- AlterTable
ALTER TABLE "payout_methods" ADD COLUMN     "account_holder_name" TEXT,
ADD COLUMN     "account_number" TEXT,
ADD COLUMN     "ifsc_code" TEXT;

-- Backfill existing rows with best-effort placeholders (raw account number was
-- never previously stored, only the masked display value).
UPDATE "payout_methods"
SET "account_holder_name" = "label",
    "account_number" = "account_masked"
WHERE "account_holder_name" IS NULL;

-- AlterTable
ALTER TABLE "payout_methods" ALTER COLUMN "account_holder_name" SET NOT NULL,
ALTER COLUMN "account_number" SET NOT NULL;
