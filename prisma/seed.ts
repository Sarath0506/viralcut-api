import { PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

/** Dev-only creators for mobile auth testing. OTP is always 000000 when seeded. */
const DEMO_OTP = "000000";

const demoCreators = [
  {
    phone: "+919876543210",
    displayName: "Demo Creator",
    email: "demo@viralcut.test",
    username: "demo_creator",
  },
  {
    phone: "+919876543211",
    displayName: "Test Creator",
    email: "test@viralcut.test",
    username: "test_creator",
  },
] as const;

async function main(): Promise<void> {
  for (const creator of demoCreators) {
    await prisma.user.upsert({
      where: { phone: creator.phone },
      create: {
        role: UserRole.creator,
        phone: creator.phone,
        displayName: creator.displayName,
        email: creator.email,
        username: creator.username,
        fixedOtpCode: DEMO_OTP,
        wallet: { create: {} },
      },
      update: {
        role: UserRole.creator,
        displayName: creator.displayName,
        email: creator.email,
        username: creator.username,
        fixedOtpCode: DEMO_OTP,
      },
    });
  }

  console.log(
    `Seeded ${demoCreators.length} demo creators (OTP ${DEMO_OTP}):\n` +
      demoCreators.map((c) => `  ${c.phone} — ${c.displayName}`).join("\n"),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
