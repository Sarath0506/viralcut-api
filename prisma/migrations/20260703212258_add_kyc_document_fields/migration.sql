-- AlterTable
ALTER TABLE "users" ADD COLUMN     "kyc_document_type" TEXT,
ADD COLUMN     "kyc_document_url" TEXT,
ADD COLUMN     "kyc_rejection_reason" TEXT,
ADD COLUMN     "kyc_reviewed_at" TIMESTAMP(3),
ADD COLUMN     "kyc_submitted_at" TIMESTAMP(3);
