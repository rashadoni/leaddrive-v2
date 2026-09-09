import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"
import { importPageConversations, type ImportResult } from "@/lib/social/import-conversations"

/**
 * Backfill existing FB Messenger + IG Direct conversations into the inbox (the webhook only catches
 * NEW messages — historical threads need this one-shot pull). Self-serve: a tenant clicks "Import
 * conversations" on Social Monitoring; no per-client setup.
 *
 *   - Facebook Messenger:  GET /{page-id}/conversations            (per facebook channel, page token)
 *   - Instagram Direct:    GET /{ig-account-id}/conversations?platform=instagram   (per instagram
 *     channel, on the IG ACCOUNT object — the page edge returns #100 even when the IG is linked)
 *
 * Each channel imports its own threads with its own token, so there's no cross-IG mis-attribution.
 * Note: IG history over the Facebook-Login page token may still be gated by Meta's Instagram messaging
 * setup / App Review for instagram_manage_messages — surfaced per-channel in the result `error`.
 */
// Гейт — `inbox` (→ omnichannel), НЕ `social`: роут живёт под /api/v1/social,
// но включает функциональность ИНБОКСА (тянет историю Messenger/IG в
// conversations). После разделения модулей (2026-08-01) соц-тенант без
// Omni-Channel не должен получать инбокс-поверхность бесплатно.
export const POST = withRlsAuth("inbox", "write", async (_req, auth) => {
  const orgId = auth.orgId

  const [fbConfigs, igConfigs] = await Promise.all([
    prisma.channelConfig.findMany({ where: { organizationId: orgId, channelType: "facebook", isActive: true } }),
    prisma.channelConfig.findMany({ where: { organizationId: orgId, channelType: "instagram", isActive: true } }),
  ])

  if (fbConfigs.length === 0) {
    return NextResponse.json({ ok: false, error: "No connected Facebook pages to import from." }, { status: 400 })
  }

  const results: ImportResult[] = []

  // Facebook Messenger: GET /{page-id}/conversations with the page token.
  for (const fb of fbConfigs) {
    if (!fb.apiKey || !fb.pageId) continue
    results.push(
      await importPageConversations(orgId, fb.pageId, fb.apiKey, "facebook", fb.id, fb.configName, [fb.pageId]),
    )
  }

  // Instagram Direct: GET /{ig-business-account-id}/conversations?platform=instagram — addressed on the
  // IG ACCOUNT object, not the page. The page edge (/{page}/conversations?platform=instagram) returns
  // (#100) even when the IG is linked; the IG account object is the documented surface. Each IG channel
  // imports its OWN threads (no cross-IG mis-attribution), with its own page token.
  for (const ig of igConfigs) {
    if (!ig.apiKey || !ig.pageId) continue
    results.push(
      await importPageConversations(orgId, ig.pageId, ig.apiKey, "instagram", ig.id, ig.configName, [ig.pageId]),
    )
  }

  const totalConversations = results.reduce((a, r) => a + r.conversations, 0)
  const totalMessages = results.reduce((a, r) => a + r.messages, 0)
  const errors = results.filter((r) => r.error).map((r) => `${r.platform}/${r.configName}: ${r.error}`)

  return NextResponse.json({ ok: true, totalConversations, totalMessages, errors, results })
})
