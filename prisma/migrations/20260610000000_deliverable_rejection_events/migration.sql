-- CreateTable
CREATE TABLE "deliverable_rejection_events" (
    "id" TEXT NOT NULL,
    "deliverable_id" TEXT NOT NULL,
    "draft_drive_url" TEXT NOT NULL,
    "rejection_reason" TEXT NOT NULL,
    "reviewed_by_user_id" TEXT,
    "rejected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deliverable_rejection_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deliverable_rejection_events_deliverable_id_rejected_at_idx" ON "deliverable_rejection_events"("deliverable_id", "rejected_at");

-- AddForeignKey
ALTER TABLE "deliverable_rejection_events" ADD CONSTRAINT "deliverable_rejection_events_deliverable_id_fkey" FOREIGN KEY ("deliverable_id") REFERENCES "format_deliverables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverable_rejection_events" ADD CONSTRAINT "deliverable_rejection_events_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
