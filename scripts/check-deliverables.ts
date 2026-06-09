import { FormatDeliverableStatus, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const [participationCount, deliverableCounts, underReview, legacySubmissions] =
    await Promise.all([
      prisma.campaignParticipation.count(),
      prisma.formatDeliverable.groupBy({
        by: ["status"],
        _count: { id: true },
      }),
      prisma.formatDeliverable.findMany({
        where: { status: FormatDeliverableStatus.under_review },
        take: 10,
        include: {
          participation: {
            include: {
              campaign: {
                select: {
                  id: true,
                  title: true,
                  status: true,
                  brandProfileId: true,
                },
              },
              creator: {
                select: { id: true, displayName: true, phone: true },
              },
            },
          },
        },
        orderBy: { draftSubmittedAt: "desc" },
      }),
      prisma.submission.count(),
    ]);

  console.log("=== DB CHECK ===");
  console.log("campaign_participations:", participationCount);
  console.log("legacy submissions:", legacySubmissions);
  console.log("format_deliverables by status:");
  for (const row of deliverableCounts) {
    console.log(`  ${row.status} -> ${row._count.id}`);
  }
  console.log("under_review samples:", underReview.length);
  for (const d of underReview) {
    console.log(
      JSON.stringify({
        deliverableId: d.id,
        platform: d.platform,
        status: d.status,
        draftSubmittedAt: d.draftSubmittedAt,
        campaignId: d.participation.campaignId,
        campaignTitle: d.participation.campaign.title,
        campaignStatus: d.participation.campaign.status,
        brandProfileId: d.participation.campaign.brandProfileId,
        creator:
          d.participation.creator.displayName ??
          d.participation.creator.phone,
        participationId: d.participationId,
      }),
    );
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
