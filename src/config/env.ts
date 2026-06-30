import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("7d"),
  /** Password reset link lifetime, e.g. `1h`, `30m` */
  PASSWORD_RESET_TTL: z.string().default("1h"),
  REDIS_URL: z.string().optional(),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  /** Unified portal public URL (reset links, invite links). */
  WEB_URL: z.string().url().default("http://localhost:3000"),
  /** Staff portal URL — used in welcome emails. Falls back to WEB_URL if unset. */
  STAFF_WEB_URL: z.string().url().optional(),
  /** @deprecated use WEB_URL */
  BRAND_WEB_URL: z.string().url().optional(),
  /** @deprecated use WEB_URL */
  AGENCY_WEB_URL: z.string().url().optional(),
  /** Brand owner invite link lifetime, e.g. `7d` */
  BRAND_INVITE_TTL: z.string().default("7d"),
  WITHDRAWAL_FEE_BPS: z.coerce.number().default(150),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_API_VERSION: z.string().default("v22.0"),
  WHATSAPP_OTP_TEMPLATE_NAME: z.string().optional(),
  /** Meta template language code, e.g. en_US or en (must match approved template). */
  WHATSAPP_OTP_TEMPLATE_LANGUAGE: z.string().default("en_US"),
  /** Set true only if your WhatsApp template includes a URL button with OTP param. */
  WHATSAPP_OTP_TEMPLATE_HAS_BUTTON: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  /** Resend HTTP API key (preferred on Railway; same `re_...` key as SMTP password). */
  RESEND_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(465),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  OTP_TTL_SECONDS: z.coerce.number().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().default(5),
  /** When true, log OTP codes in API console (use with NODE_ENV=development). */
  OTP_DEV_LOG: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  /**
   * Fixed OTP for local testing (e.g. 000000). Only used when NODE_ENV=development.
   * Run seed for demo creator phones; no WhatsApp required.
   */
  OTP_DEV_BYPASS_CODE: z.string().length(6).optional(),
  /** Cloudflare R2 (S3-compatible). When all five are set, uploads go to R2. */
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_PUBLIC_BASE_URL: z.string().url().optional(),
}).superRefine((data, ctx) => {
  const r2Fields = [
    ["S3_ENDPOINT", data.S3_ENDPOINT],
    ["S3_BUCKET", data.S3_BUCKET],
    ["S3_ACCESS_KEY_ID", data.S3_ACCESS_KEY_ID],
    ["S3_SECRET_ACCESS_KEY", data.S3_SECRET_ACCESS_KEY],
    ["S3_PUBLIC_BASE_URL", data.S3_PUBLIC_BASE_URL],
  ] as const;
  const setCount = r2Fields.filter(([, value]) => Boolean(value)).length;

  if (setCount === 0 || setCount === r2Fields.length) {
    return;
  }

  for (const [field] of r2Fields) {
    ctx.addIssue({
      code: "custom",
      path: [field],
      message: "Set all S3_* variables together for R2 uploads, or leave them all unset",
    });
  }
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(
  config: Record<string, unknown>,
): Env {
  const normalized = { ...config };
  if (!normalized.WEB_URL) {
    normalized.WEB_URL =
      normalized.BRAND_WEB_URL ?? normalized.AGENCY_WEB_URL ?? "http://localhost:3000";
  }
  const parsed = envSchema.safeParse(normalized);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${message}`);
  }

  const env = parsed.data;
  if (
    env.OTP_DEV_BYPASS_CODE &&
    env.NODE_ENV !== "development"
  ) {
    console.warn(
      "[env] OTP_DEV_BYPASS_CODE is set but ignored outside NODE_ENV=development",
    );
  }
  if (env.OTP_DEV_LOG && env.NODE_ENV !== "development") {
    console.warn(
      "[env] OTP_DEV_LOG is set but OTP console logging only runs in NODE_ENV=development",
    );
  }

  return env;
}
