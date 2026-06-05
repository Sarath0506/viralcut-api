import {
  AgencyBrandStatus,
  AgencyMembershipRole,
  BrandMembershipRole,
  BrandInviteStatus,
  PrismaClient,
  UserRole,
  CampaignStatus,
} from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { hashRefreshToken } from "../src/auth/otp.service";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const brandPasswordHash = await bcrypt.hash("DemoBrand123!", 12);
  const agencyPasswordHash = await bcrypt.hash("DemoAgency123!", 12);

  const brandUser = await prisma.user.upsert({
    where: { email: "brand@demo.viralcut.in" },
    update: { passwordHash: brandPasswordHash },
    create: {
      role: UserRole.brand,
      email: "brand@demo.viralcut.in",
      passwordHash: brandPasswordHash,
      displayName: "boAt Demo",
      brandProfile: {
        create: { companyName: "boAt Lifestyle" },
      },
      wallet: { create: {} },
    },
    include: { brandProfile: true },
  });

  if (!brandUser.brandProfile) {
    throw new Error("Brand profile missing after seed");
  }

  await prisma.brandMembership.upsert({
    where: {
      brandProfileId_userId: {
        brandProfileId: brandUser.brandProfile.id,
        userId: brandUser.id,
      },
    },
    update: {},
    create: {
      brandProfileId: brandUser.brandProfile.id,
      userId: brandUser.id,
      role: BrandMembershipRole.owner,
    },
  });

  const agencyUser = await prisma.user.upsert({
    where: { email: "agency@demo.viralcut.in" },
    update: { passwordHash: agencyPasswordHash },
    create: {
      role: UserRole.agency,
      email: "agency@demo.viralcut.in",
      passwordHash: agencyPasswordHash,
      displayName: "Demo Agency",
      agencyMemberships: {
        create: {
          role: AgencyMembershipRole.owner,
          agency: { create: { companyName: "ViralCut Demo Agency" } },
        },
      },
    },
    include: {
      agencyMemberships: { include: { agency: true } },
    },
  });

  const agency = agencyUser.agencyMemberships[0]?.agency;
  if (!agency) {
    throw new Error("Agency missing after seed");
  }

  const managedBrand = await prisma.brandProfile.upsert({
    where: { id: "seed-brand-noise" },
    update: { companyName: "Noise Audio" },
    create: {
      id: "seed-brand-noise",
      companyName: "Noise Audio",
      agencyLink: {
        create: {
          agencyId: agency.id,
          status: AgencyBrandStatus.active,
        },
      },
    },
  });

  await prisma.campaign.upsert({
    where: { id: "seed-campaign-boat" },
    update: {},
    create: {
      id: "seed-campaign-boat",
      brandProfileId: brandUser.brandProfile.id,
      title: "boAt Airdopes 800 — Instagram Reels",
      category: "Electronics",
      platform: "instagram_reel",
      platforms: ["instagram_reel"],
      status: CampaignStatus.live,
      brief:
        "Create high-energy lifestyle Reels featuring Airdopes 800. Natural product use, trending audio.",
      productUrl: "https://www.boat-lifestyle.com",
      ratePer1kPaise: 5000,
      maxPayoutPaise: 5_000_000,
      budgetPaise: 10_000_000,
      budgetUsedPaise: 8_200_000,
    },
  });

  await prisma.campaign.upsert({
    where: { id: "seed-campaign-noise" },
    update: {},
    create: {
      id: "seed-campaign-noise",
      brandProfileId: managedBrand.id,
      createdByUserId: agencyUser.id,
      title: "Noise Buds — Agency managed",
      category: "Electronics",
      platform: "instagram_reel",
      platforms: ["instagram_reel"],
      status: CampaignStatus.draft,
      brief: "Draft campaign created by demo agency for Noise Audio.",
      ratePer1kPaise: 5000,
      maxPayoutPaise: 5_000_000,
      budgetPaise: 5_000_000,
    },
  });

  const inviteToken = "demo-brand-invite-token-for-local-testing-only";
  await prisma.brandInvite.upsert({
    where: { tokenHash: hashRefreshToken(inviteToken) },
    update: {},
    create: {
      brandProfileId: managedBrand.id,
      agencyId: agency.id,
      email: "pending-owner@demo.viralcut.in",
      tokenHash: hashRefreshToken(inviteToken),
      status: BrandInviteStatus.pending,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      invitedByUserId: agencyUser.id,
    },
  });

  await prisma.agencyBrand.upsert({
    where: { brandProfileId: brandUser.brandProfile.id },
    update: { status: AgencyBrandStatus.active },
    create: {
      agencyId: agency.id,
      brandProfileId: brandUser.brandProfile.id,
      status: AgencyBrandStatus.active,
    },
  });

  const demoCreators = [
    {
      phone: "+919876543210",
      email: "pragnatej@demo.viralcut.in",
      displayName: "Pragnatej",
      username: "pragnatej",
      fixedOtpCode: "000000",
    },
    {
      phone: "+916281068402",
      email: "creator@demo.viralcut.in",
      displayName: "Demo Creator",
      username: "democreator",
      fixedOtpCode: "000000",
    },
  ] as const;

  for (const demo of demoCreators) {
    const creator = await prisma.user.upsert({
      where: { phone: demo.phone },
      update: {
        email: demo.email,
        displayName: demo.displayName,
        username: demo.username,
        fixedOtpCode: demo.fixedOtpCode,
      },
      create: {
        role: UserRole.creator,
        phone: demo.phone,
        email: demo.email,
        displayName: demo.displayName,
        username: demo.username,
        fixedOtpCode: demo.fixedOtpCode,
        wallet: {
          create: {
            availablePaise: 3_517_000,
            pendingPaise: 522_000,
            lifetimePaise: 4_039_000,
          },
        },
      },
      include: { wallet: true },
    });

    if (creator.wallet) {
      await prisma.payoutMethod.upsert({
        where: { id: `seed-payout-${demo.username}` },
        update: {},
        create: {
          id: `seed-payout-${demo.username}`,
          userId: creator.id,
          type: "bank",
          label: "HDFC Bank",
          accountMasked: "•••• 1234",
          isDefault: true,
        },
      });
    }
  }

  console.log("Seed complete:");
  console.log("  Brand login: brand@demo.viralcut.in / DemoBrand123!");
  console.log("  Agency login: agency@demo.viralcut.in / DemoAgency123!");
  console.log(
    "  Pending invite: http://localhost:3000/invite/accept?token=demo-brand-invite-token-for-local-testing-only",
  );
  console.log("  Demo creators (fixed OTP 000000, stored in DB — no WhatsApp):");
  for (const demo of demoCreators) {
    console.log(`    ${demo.displayName} — ${demo.phone} — ${demo.email}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
