-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "max_reposts_per_clip" INTEGER DEFAULT 5;

-- AlterTable
ALTER TABLE "format_deliverables" ADD COLUMN     "delisted_at" TIMESTAMP(3),
ADD COLUMN     "listed_in_marketplace" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "marketplace_reposts" (
    "id" TEXT NOT NULL,
    "source_deliverable_id" TEXT NOT NULL,
    "poster_deliverable_id" TEXT NOT NULL,
    "poster_creator_id" TEXT NOT NULL,
    "original_creator_share_paise" INTEGER,
    "poster_share_paise" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_reposts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_reposts_poster_deliverable_id_key" ON "marketplace_reposts"("poster_deliverable_id");

-- CreateIndex
CREATE INDEX "marketplace_reposts_source_deliverable_id_idx" ON "marketplace_reposts"("source_deliverable_id");

-- CreateIndex
CREATE INDEX "marketplace_reposts_poster_creator_id_created_at_idx" ON "marketplace_reposts"("poster_creator_id", "created_at");

-- CreateIndex
CREATE INDEX "format_deliverables_listed_in_marketplace_delisted_at_idx" ON "format_deliverables"("listed_in_marketplace", "delisted_at");

-- AddForeignKey
ALTER TABLE "marketplace_reposts" ADD CONSTRAINT "marketplace_reposts_source_deliverable_id_fkey" FOREIGN KEY ("source_deliverable_id") REFERENCES "format_deliverables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_reposts" ADD CONSTRAINT "marketplace_reposts_poster_deliverable_id_fkey" FOREIGN KEY ("poster_deliverable_id") REFERENCES "format_deliverables"("id") ON DELETE CASCADE ON UPDATE CASCADE;
