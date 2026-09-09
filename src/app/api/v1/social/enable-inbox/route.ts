import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls, withRlsAuth } from "@/lib/with-rls"
import { decryptToken } from "@/lib/secure-token"
import { ensureInboxChannelForPage } from "@/lib/social/inbox-channel"

/**
 * Backfill (FB/IG inbox Slice 3): for the org's already-connected Facebook/Instagram SocialAccounts
 * (set up in Social Monitoring), wire each as an INBOX channel — create a ChannelConfig + subscribe
 * the page to Meta's DM webhook — WITHOUT re-running OAuth. This lets pages connected before Slice 2
 * (e.g. nokaut.az, kishiklubu.az) start receiving Messenger/Direct messages in the inbox.
 *
 * Idempotent (ensureInboxChannelForPage upserts) → safe to run repeatedly. Per-account fail-soft so
 * one bad/expired token doesn't abort the rest.
 */
// POST включает ИНБОКС-канал (ChannelConfig + подписка страницы на DM-вебхук
// Meta), поэтому с 2026-08-01 требует модуль Omni-Channel: путь уже гейтится
// `social` в middleware, а этот гейт добавляет второй — соц-тенант без
// Omni-Channel не должен заводить себе инбокс-каналы. GET ниже — только
// статус для баннера на странице соцмониторинга, он остаётся на `social`.
export const POST = withRlsAuth("inbox", "write", async (_req, { orgId }) => {
  const accounts = await prisma.socialAccount.findMany({
    where: {
      organizationId: orgId,
      platform: { in: ["facebook", "instagram"] },
      isActive: true,
      accessToken: { not: null },
    },
    select: { platform: true, handle: true, displayName: true, accessToken: true },
  })

  const results: Array<{
    platform: string
    handle: string
    created?: boolean
    subscribed?: boolean
    error?: string
  }> = []

  for (const acc of accounts) {
    try {
      // Same AAD/context the OAuth callback encrypted with: oauth:<platform>:<handle>.
      const token = decryptToken(acc.accessToken as string, `oauth:${acc.platform}:${acc.handle}`)
      const r = await ensureInboxChannelForPage(
        orgId,
        acc.platform as "facebook" | "instagram",
        acc.handle,
        acc.displayName || acc.handle,
        token,
      )
      results.push({ platform: acc.platform, handle: acc.handle, created: r.created, subscribed: r.subscribed })
    } catch (e) {
      results.push({ platform: acc.platform, handle: acc.handle, error: (e as Error)?.message || "failed" })
    }
  }

  return NextResponse.json({
    success: true,
    total: accounts.length,
    wired: results.filter((r) => !r.error).length,
    results,
  })
})

/**
 * Inbox-status for the org's FB/IG accounts — drives the Social Monitoring "reconnect" banner.
 * `needsReconnect` is true when pages are wired (ChannelConfig exists) but Meta isn't delivering DMs
 * (settings.inboxSubscribed !== true) — almost always a missing DM scope, fixed by re-OAuth.
 */
export const GET = withRls(async (_req, { orgId }) => {
  const [totalAccounts, channels] = await Promise.all([
    prisma.socialAccount.count({
      where: { organizationId: orgId, platform: { in: ["facebook", "instagram"] }, isActive: true },
    }),
    prisma.channelConfig.findMany({
      where: { organizationId: orgId, channelType: { in: ["facebook", "instagram"] }, isActive: true },
      select: { settings: true },
    }),
  ])

  const subFlag = (c: { settings: unknown }): boolean | undefined => {
    const s = c.settings
    if (s && typeof s === "object" && !Array.isArray(s)) return (s as Record<string, unknown>).inboxSubscribed as boolean | undefined
    return undefined
  }
  const wired = channels.length
  const subscribed = channels.filter((c: { settings: unknown }) => subFlag(c) === true).length

  return NextResponse.json({
    hasAccounts: totalAccounts > 0,
    totalAccounts,
    wired,
    subscribed,
    // Only flag a re-connect when a managed channel EXPLICITLY failed its subscribe (inboxSubscribed
    // === false). Channels with no flag (legacy/manually-entered configs, never auto-wired) are not
    // "failed" — excluding them keeps the banner from sticking on stale rows.
    needsReconnect: channels.some((c: { settings: unknown }) => subFlag(c) === false),
  })
})
