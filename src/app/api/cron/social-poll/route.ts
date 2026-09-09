import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { pollAllTwitter } from "@/lib/social/twitter-poller"
import { pollAllTikTok } from "@/lib/social/tiktok-poller"
import { pollAllYouTube } from "@/lib/social/youtube-poller"
import { pollAllVk } from "@/lib/social/vk-poller"
import { scanTelegramForOrg } from "@/lib/social/telegram-scanner"
import { detectNegativeSpikes } from "@/lib/social/spike-alerts"
import { withSocialMonitoringTenantCollectionFence } from "@/lib/social/monitoring-import-fence"

/**
 * Cron-triggered social polling runner.
 * Protect with CRON_SECRET env var; callers must send Authorization: Bearer <CRON_SECRET>.
 */
export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
    const cronError = requireCronAuth(req)
    if (cronError) return cronError

    const activeAccountRows = await prisma.socialAccount.findMany({
      where: { isActive: true },
      select: { organizationId: true, platform: true },
      distinct: ["organizationId", "platform"],
    })
    const organizationIds = Array.from(new Set(activeAccountRows.map(row => row.organizationId)))
    const telegramOrganizationIds = new Set(
      activeAccountRows
        .filter(row => row.platform === "telegram")
        .map(row => row.organizationId),
    )
    const totals = {
      twitter: { total: 0, accounts: 0 },
      tiktok: { total: 0, accounts: 0 },
      youtube: { total: 0, accounts: 0 },
      vk: { total: 0, accounts: 0 },
      telegram: { total: 0, orgs: 0 },
    }
    const blockedOrganizations: string[] = []

    for (const organizationId of organizationIds) {
      const fenced = await withSocialMonitoringTenantCollectionFence(
        organizationId,
        async () => {
          const [twitter, tiktok, youtube, vk, telegram] = await Promise.all([
            pollAllTwitter(organizationId).catch(e => ({ total: 0, perAccount: [], error: e?.message })),
            pollAllTikTok(organizationId).catch(e => ({ total: 0, accounts: 0, error: e?.message })),
            pollAllYouTube(organizationId).catch(e => ({ total: 0, accounts: 0, error: e?.message })),
            pollAllVk(organizationId).catch(e => ({ total: 0, accounts: 0, error: e?.message })),
            telegramOrganizationIds.has(organizationId)
              ? scanTelegramForOrg(organizationId).catch(e => ({ ingested: 0, error: e?.message }))
              : Promise.resolve({ ingested: 0 }),
          ])
          return { twitter, tiktok, youtube, vk, telegram }
        },
      )
      if (!fenced.allowed) {
        blockedOrganizations.push(organizationId)
        continue
      }
      totals.twitter.total += fenced.value.twitter.total
      totals.twitter.accounts += fenced.value.twitter.perAccount.length
      totals.tiktok.total += fenced.value.tiktok.total
      totals.tiktok.accounts += fenced.value.tiktok.accounts
      totals.youtube.total += fenced.value.youtube.total
      totals.youtube.accounts += fenced.value.youtube.accounts
      totals.vk.total += fenced.value.vk.total
      totals.vk.accounts += fenced.value.vk.accounts
      totals.telegram.total += fenced.value.telegram.ingested
      if (telegramOrganizationIds.has(organizationId)) totals.telegram.orgs += 1
    }
    const spikes = await detectNegativeSpikes()

    return NextResponse.json({
      success: true,
      data: {
        ...totals,
        spikes,
        blockedOrganizations,
      },
    })
  })
}
