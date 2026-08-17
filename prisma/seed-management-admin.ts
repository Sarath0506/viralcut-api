import { AdminPermissionLevel, PrismaClient, UserRole } from "@prisma/client";
import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const ROLE_NAME = "Management";

/** Moderation, support and communications desk: reviews/actions creator
 * accounts and tickets, sends comms, sees campaign/brand context read-only.
 * No money visibility, no team/role management. */
const MANAGEMENT_PERMISSIONS: Record<string, AdminPermissionLevel> = {
  dashboard: AdminPermissionLevel.hidden,
  brands: AdminPermissionLevel.view,
  clippers: AdminPermissionLevel.manage,
  campaigns: AdminPermissionLevel.view,
  analytics: AdminPermissionLevel.view,
  tickets: AdminPermissionLevel.manage,
  faqs: AdminPermissionLevel.manage,
  notifications: AdminPermissionLevel.manage,
  team: AdminPermissionLevel.hidden,
};

async function main(): Promise<void> {
  const email = process.env.MANAGEMENT_ADMIN_EMAIL?.toLowerCase().trim();
  const password = process.env.MANAGEMENT_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error("MANAGEMENT_ADMIN_EMAIL and MANAGEMENT_ADMIN_PASSWORD must be set");
  }

  const role = await prisma.adminRole.upsert({
    where: { name: ROLE_NAME },
    create: {
      name: ROLE_NAME,
      canSeeMoney: false,
      permissions: {
        create: Object.entries(MANAGEMENT_PERMISSIONS).map(([section, level]) => ({
          section: section as never,
          level,
        })),
      },
    },
    update: {},
  });

  // Keep permissions in sync if this script is re-run after the defaults change.
  await prisma.$transaction(
    Object.entries(MANAGEMENT_PERMISSIONS).map(([section, level]) =>
      prisma.adminSectionPermission.upsert({
        where: { adminRoleId_section: { adminRoleId: role.id, section: section as never } },
        create: { adminRoleId: role.id, section: section as never, level },
        update: { level },
      }),
    ),
  );

  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && existing.role !== UserRole.admin) {
    throw new Error(`Email ${email} already exists with role "${existing.role}", not admin`);
  }

  const user = await prisma.user.upsert({
    where: { email },
    create: {
      role: UserRole.admin,
      email,
      passwordHash,
      displayName: ROLE_NAME,
      adminRoleId: role.id,
      termsAcceptedAt: new Date(),
    },
    update: {
      passwordHash,
      adminRoleId: role.id,
    },
  });

  console.log(`Seeded admin role "${ROLE_NAME}" and account ${user.email} (${user.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
