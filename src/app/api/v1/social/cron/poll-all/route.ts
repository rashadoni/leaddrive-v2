import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { requireCronAuth } from "@/lib/cron-auth"
import { pollFacebookAccount, pollInstagramAccount } from "@/lib/social/facebook-poller"
import { pollTwitterAccount } from "@/lib/social/twitter-poller"
import { pollVkAccount } from "@/lib/social/vk-poller"
import { pollYouTubeAccount } from "@/lib/social/youtube-poller"
import { pollTikTokAccount } from "@/lib/social/tiktok-poller"
import { scanTelegramForOrg } from "@/lib/social/telegram-scanner"
import { sendPushToUser } from "@/lib/push-send"
import { withJobLease } from "@/lib/cron/job-lease"
import { withSocialMonitoringTenantCollectionFence } from "@/lib/social/monitoring-import-fence"

/**
 * Cron job: poll every active social account, then check each org for a
 * negative-mention spike — today's count >= 3 AND > 2× the trailing 7-day
 * average. On spike, fire a web-push to every admin/manager in the org.
 *
 * Auth: Bearer CRON_SECRET. Designed to be called by instrumentation.ts every
 * 15 min, but also safe to call manually for testing.
 */
async function executeSocialPoll() {
  const accounts = await prisma.socialAccount.findMany({
    where: { isActive: true },
  })

  const polled: Array<{ id: string; platform: string; ingested: number; error?: string }> = []
  const orgsTouched = new Set<string>()

  for (const acc of accounts) {
    let result: { ingested: number; error?: string } = { ingested: 0 }
    try {
      // Hold the tenant clean-slate lock across both the external poll and its
      // persistence. If reset wins the lock, no provider call is made; if this
      // poll wins, reset waits and then removes every write from the poll.
      const fenced = await withSocialMonitoringTenantCollectionFence(
        acc.organizationId,
        async () => {
          switch (acc.platform) {
            case "facebook":
              if (!acc.accessToken) return { ingested: 0, error: "no_token" }
              return pollFacebookAccount(acc.id)
            case "instagram":
              if (!acc.accessToken) return { ingested: 0, error: "no_token" }
              return pollInstagramAccount(acc.id)
            case "twitter":
              if (!acc.accessToken) return { ingested: 0, error: "no_token" }
              return pollTwitterAccount(acc.id)
            case "vkontakte":
              return pollVkAccount(acc.id)
            case "youtube":
              return pollYouTubeAccount(acc.id)
            case "tiktok":
              return pollTikTokAccount(acc.id)
            case "telegram":
              return scanTelegramForOrg(acc.organizationId)
            default:
              return { ingested: 0 }
          }
        },
      )
      result = fenced.allowed
        ? fenced.value
        : { ingested: 0, error: fenced.reason }
    } catch (error: unknown) {
      result = { ingested: 0, error: error instanceof Error ? error.message : "exception" }
    }
    polled.push({ id: acc.id, platform: acc.platform, ...result })
    if (result.ingested > 0) orgsTouched.add(acc.organizationId)
  }

  // Spike detection per org. Fires once per org per cron tick — push handlers
  // dedupe by tag (`ld-social-spike-<orgId>`) so consecutive ticks don't spam.
  const spikes: Array<{ orgId: string; today: number; avg7d: number; alerted: number }> = []
  for (const orgId of orgsTouched) {
    const fenced = await withSocialMonitoringTenantCollectionFence(orgId, async () => {
      const now = new Date()
      const startOfToday = new Date(now)
      startOfToday.setUTCHours(0, 0, 0, 0)
      const startOf7dAgo = new Date(startOfToday.getTime() - 7 * 86400_000)

      const [today, last7d] = await Promise.all([
        prisma.socialMention.count({
          where: {
            organizationId: orgId,
            sentiment: "negative",
            createdAt: { gte: startOfToday },
            purgedAt: null,
            deletedAtSource: null,
          },
        }),
        prisma.socialMention.count({
          where: {
            organizationId: orgId,
            sentiment: "negative",
            createdAt: { gte: startOf7dAgo, lt: startOfToday },
            purgedAt: null,
            deletedAtSource: null,
          },
        }),
      ])
      const avg7d = last7d / 7
      if (today < 3 || today <= avg7d * 2) return null

      const recipients = await prisma.user.findMany({
        where: { organizationId: orgId, role: { in: ["admin", "manager", "support", "superadmin"] } },
        select: { id: true },
      })
      let alerted = 0
      for (const recipient of recipients) {
        try {
          await sendPushToUser(orgId, recipient.id, {
            title: "🔴 Negative-mention spike",
            body: `${today} negative mentions today vs 7-day avg ${avg7d.toFixed(1)}. Open the inbox.`,
            url: "/social-monitoring?sentiment=negative",
            tag: `ld-social-spike-${orgId}`,
          })
          alerted++
        } catch (error) {
          console.error("[social-cron] push to user failed:", error)
        }
      }
      return { orgId, today, avg7d: Number(avg7d.toFixed(1)), alerted }
    })
    if (fenced.allowed && fenced.value) spikes.push(fenced.value)
  }

  return NextResponse.json({
    success: true,
    data: {
      pollerCount: accounts.length,
      ingestedTotal: polled.reduce((a, b) => a + b.ingested, 0),
      polled,
      spikes,
    },
  })
}

export async function POST(req: NextRequest) {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  return runWithRlsBypass(async () => {
    const lease = await withJobLease(
      { name: "social-poll-all", ttlMs: 15 * 60_000 },
      executeSocialPoll,
    )
    if (lease.status === "skipped") {
      return NextResponse.json({ success: true, skipped: true, reason: lease.reason })
    }
    return lease.value
  })
}
