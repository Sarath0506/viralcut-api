/**
 * One-off backfill: encrypts any PayoutMethod.accountNumber still stored in
 * plaintext, using the same AES-256-GCM scheme payouts.service.ts now writes
 * with going forward. Idempotent — rows already in "iv.tag.ciphertext" form
 * are detected (by decoding and checking the IV/tag byte lengths) and left
 * untouched, so this is safe to re-run.
 *
 * Usage:
 *   npx tsx scripts/encrypt-payout-accounts.ts
 */
import { PrismaClient } from "@prisma/client";
import { createCipheriv, createHash, randomBytes } from "node:crypto";

const prisma = new PrismaClient();

function encryptionKey(): Buffer {
  const secret = process.env.PAYOUT_ACCOUNT_ENCRYPTION_KEY ?? process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("Set PAYOUT_ACCOUNT_ENCRYPTION_KEY or JWT_SECRET before running this script.");
  }
  return createHash("sha256").update(secret).digest();
}

function encryptAccount(value: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function looksAlreadyEncrypted(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const [ivRaw, tagRaw] = parts;
  try {
    return Buffer.from(ivRaw, "base64url").length === 12 && Buffer.from(tagRaw, "base64url").length === 16;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const key = encryptionKey();
  const methods = await prisma.payoutMethod.findMany({
    select: { id: true, accountNumber: true },
  });

  let encrypted = 0;
  let skipped = 0;

  for (const method of methods) {
    if (looksAlreadyEncrypted(method.accountNumber)) {
      skipped++;
      continue;
    }
    await prisma.payoutMethod.update({
      where: { id: method.id },
      data: { accountNumber: encryptAccount(method.accountNumber, key) },
    });
    encrypted++;
  }

  console.log(`Encrypted ${encrypted} row(s), skipped ${skipped} already-encrypted row(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
