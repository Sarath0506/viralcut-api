-- CreateTable
CREATE TABLE "bulk_notification_logs" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "used_push" BOOLEAN NOT NULL DEFAULT false,
    "used_whatsapp" BOOLEAN NOT NULL DEFAULT false,
    "recipient_ids" TEXT[],
    "recipient_count" INTEGER NOT NULL,
    "push_sent_count" INTEGER NOT NULL DEFAULT 0,
    "push_failed_count" INTEGER NOT NULL DEFAULT 0,
    "whatsapp_sent_count" INTEGER NOT NULL DEFAULT 0,
    "whatsapp_failed_count" INTEGER NOT NULL DEFAULT 0,
    "sent_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bulk_notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bulk_notification_logs_created_at_idx" ON "bulk_notification_logs"("created_at");

-- AddForeignKey
ALTER TABLE "bulk_notification_logs" ADD CONSTRAINT "bulk_notification_logs_sent_by_user_id_fkey" FOREIGN KEY ("sent_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
