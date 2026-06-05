-- Demo / test creator accounts: fixed OTP stored on user row (e.g. 000000).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "fixed_otp_code" VARCHAR(6);

COMMENT ON COLUMN "users"."fixed_otp_code" IS 'When set, this phone always uses this OTP instead of WhatsApp (demo accounts only)';
