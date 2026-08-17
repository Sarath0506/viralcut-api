-- CreateTable
CREATE TABLE "faqs" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "is_visible" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faqs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "faqs_order_idx" ON "faqs"("order");

-- Seed with the FAQs that were previously hardcoded in the mobile app's
-- Support Center screen, so switching it over to this table doesn't blank
-- out existing content.
INSERT INTO "faqs" ("id", "question", "answer", "order", "is_visible", "created_at", "updated_at") VALUES
('seed-faq-1', 'When do I get paid for my views?', 'Once your live post is approved, view counts refresh periodically and your earnings move to "Pending" first. They become withdrawable once the brand''s review window closes for that submission.', 0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('seed-faq-2', 'Why was my draft or live proof rejected?', 'Check the rejection reason on the submission''s details page — it''s left by the brand reviewer. Common causes are missing the product, not following the content brief, or a private/unreachable post link.', 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('seed-faq-3', 'How long does KYC verification take?', 'Most KYC submissions are reviewed within 1-2 business days. You''ll get a notification the moment it''s approved or if we need a clearer document.', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('seed-faq-4', 'Why do I need to add bank details before withdrawing?', 'We need your account holder name, account number (or UPI ID), and IFSC code to actually send the payout to the right place. This is a one-time setup — after that, withdrawals just need an amount.', 3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('seed-faq-5', 'Can I use the same login on two accounts?', 'No — each account is tied to one phone number and there''s no account-switcher today. If you manage more than one creator profile, sign up with a separate phone number for each and log out/in to switch.', 4, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('seed-faq-6', 'A campaign I joined got paused — what happens to my submission?', 'Nothing is lost. Pausing is temporary and only stops new submissions; your existing drafts, reviews, and live proof keep whatever stage they were already in.', 5, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
