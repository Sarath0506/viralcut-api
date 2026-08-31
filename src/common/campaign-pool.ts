import type { PrismaService } from "../prisma/prisma.service";

/** Sum of every deliverable's payout contribution toward a campaign's budget
 * pool, capped per-deliverable at that campaign's maxPayoutPaise — the same
 * LEAST(...) cap computeEstimatedPaise applies. paidAmountPaise (once a
 * payout has actually been processed) always wins over the live estimate. */
export async function getCampaignPoolUsage(
  prisma: PrismaService,
  campaignId: string,
): Promise<number> {
  const rows = await prisma.$queryRaw<{ total: bigint }[]>`
    SELECT COALESCE(SUM(
      COALESCE(
        fd.paid_amount_paise,
        LEAST(
          FLOOR(fd.view_count::numeric * c.rate_per_1k_paise::numeric / 1000),
          c.max_payout_paise::numeric
        )
      )
    ), 0) AS total
    FROM campaign_participations cp
    JOIN format_deliverables fd ON fd.participation_id = cp.id
    JOIN campaigns c ON c.id = cp.campaign_id
    WHERE cp.campaign_id = ${campaignId}
  `;
  return Number(rows[0]?.total ?? 0);
}

/** Same as getCampaignPoolUsage, but for many campaigns at once — used
 * anywhere a list of campaigns needs each one's live budgetUsedPaise. */
export async function getCampaignPoolUsageMap(
  prisma: PrismaService,
  campaignIds: string[],
): Promise<Record<string, number>> {
  if (!campaignIds.length) return {};
  const rows = await prisma.$queryRaw<{ campaign_id: string; total: bigint }[]>`
    SELECT
      cp.campaign_id,
      COALESCE(SUM(
        COALESCE(
          fd.paid_amount_paise,
          LEAST(
            FLOOR(fd.view_count::numeric * c.rate_per_1k_paise::numeric / 1000),
            c.max_payout_paise::numeric
          )
        )
      ), 0) AS total
    FROM campaign_participations cp
    JOIN format_deliverables fd ON fd.participation_id = cp.id
    JOIN campaigns c ON c.id = cp.campaign_id
    WHERE cp.campaign_id = ANY(${campaignIds}::text[])
    GROUP BY cp.campaign_id
  `;
  return Object.fromEntries(rows.map((r) => [r.campaign_id, Number(r.total)]));
}
