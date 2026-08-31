import type { PrismaService } from "../prisma/prisma.service";

/** Sum of every deliverable's payout contribution toward a campaign's budget
 * pool. paidAmountPaise (once a payout has actually been processed) always
 * wins over the live estimate — that figure is itself already capped at
 * payout time (see computeEstimatedPaise), so it's summed as-is regardless
 * of allowExcessViewsToFillPool below.
 *
 * For deliverables still in-flight (no paidAmountPaise yet), each campaign's
 * own allow_excess_views_to_fill_pool decides how its estimate counts toward
 * the pool total:
 *  - false (default): capped at maxPayoutPaise per deliverable, same as an
 *    individual clipper's own payout ceiling — a campaign can't hit 100%
 *    pool usage just because one clipper massively overperformed.
 *  - true (admin opt-in per campaign): the real uncapped estimate counts,
 *    letting overperforming clippers' extra views fill the remaining pool.
 *    This never raises what that clipper is actually paid — only how much
 *    of the pool their overperformance is considered to have used. */
export async function getCampaignPoolUsage(
  prisma: PrismaService,
  campaignId: string,
): Promise<number> {
  const rows = await prisma.$queryRaw<{ total: bigint }[]>`
    SELECT COALESCE(SUM(
      COALESCE(
        fd.paid_amount_paise,
        CASE WHEN c.allow_excess_views_to_fill_pool THEN
          FLOOR(fd.view_count::numeric * c.rate_per_1k_paise::numeric / 1000)
        ELSE
          LEAST(
            FLOOR(fd.view_count::numeric * c.rate_per_1k_paise::numeric / 1000),
            c.max_payout_paise::numeric
          )
        END
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
 * anywhere a list of campaigns needs each one's live budgetUsedPaise. Each
 * campaign's own allow_excess_views_to_fill_pool is honored independently. */
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
          CASE WHEN c.allow_excess_views_to_fill_pool THEN
            FLOOR(fd.view_count::numeric * c.rate_per_1k_paise::numeric / 1000)
          ELSE
            LEAST(
              FLOOR(fd.view_count::numeric * c.rate_per_1k_paise::numeric / 1000),
              c.max_payout_paise::numeric
            )
          END
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
