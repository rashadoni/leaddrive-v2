import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { ingestMentionWithResult } from "@/lib/social/ingest-mention"
import { findMatchedKeyword } from "@/lib/social/keyword-match"
import { withSocialMonitoringTenantCollectionFence } from "@/lib/social/monitoring-import-fence"
import { parentMatchContextsForComments } from "@/lib/social/parent-match-context"

/**
 * FB "feed" webhooks carry created_time as epoch SECONDS (integer); other Meta
 * payloads use ISO strings. new Date(seconds) would yield January 1970 and poison
 * the dedupe day-bucket and cluster recency.
 */
function parseMetaTime(value: unknown): Date {
  let parsed: Date
  if (typeof value === "number") parsed = new Date(value * 1000)
  else if (typeof value === "string" && /^\d+$/.test(value)) parsed = new Date(Number(value) * 1000)
  else if (typeof value === "string" && value) parsed = new Date(value)
  else return new Date()
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

type MetaWebhookValue = {
  item?: string
  comment_id?: string | number
  id?: string | number
  message?: string
  comment?: string
  text?: string
  from?: { id?: string; name?: string; username?: string }
  post_id?: string
  media_id?: string
  parent_id?: string
  permalink_url?: string
  comment_url?: string
  post_permalink?: string
  created_time?: string | number
}

type MetaWebhookChange = MetaWebhookValue & { value?: MetaWebhookValue }
type MetaWebhookEntry = { id?: string; changes?: MetaWebhookChange[]; messaging?: MetaWebhookChange[] }
type MetaWebhookBody = { entry?: MetaWebhookEntry[]; object?: string }

/**
 * Meta Graph webhook receiver — accepts Facebook Page and Instagram Business comment events.
 * To use:
 *   1. Create an app in the Meta Developer Console.
 *   2. Subscribe to the "feed" / "comments" events for your page/IG business account.
 *   3. Point the webhook at `https://<domain>/api/v1/webhooks/meta-social` with verify token
 *      set via env `META_WEBHOOK_VERIFY_TOKEN`. Signing secret goes in `META_WEBHOOK_SECRET`.
 */

// Verification handshake
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get("hub.mode")
  const token = searchParams.get("hub.verify_token")
  const challenge = searchParams.get("hub.challenge")
  if (mode === "subscribe" && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge || "", { status: 200 })
  }
  return NextResponse.json({ error: "Verify failed" }, { status: 403 })
}

function verifySignature(raw: string, signature: string | null): boolean {
  const secret = process.env.META_WEBHOOK_SECRET
  if (!secret || !signature) return false
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex")
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length) return false
  try {
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  const signature = req.headers.get("x-hub-signature-256")
  if (!verifySignature(raw, signature)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 })
  }

  let body: MetaWebhookBody
  try {
    body = JSON.parse(raw) as MetaWebhookBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const entries = body.entry || []
  const object: string = body.object || ""
  // "page" for Facebook pages, "instagram" for IG Business
  const platform = object === "instagram" ? "instagram" : "facebook"

  let ingested = 0
  let blocked = 0
  for (const entry of entries) {
    const pageId: string = entry.id || ""
    // Find the SocialAccount that owns this page / IG ID
    // RLS: this lookup IS the org resolution (page/IG id is an external identifier) → bypass scope.
    const account = await runWithRlsBypass(() =>
      prisma.socialAccount.findFirst({
        where: { platform, handle: pageId },
      })
    )
    if (!account) continue

    // The outer tenant scope is required because the fence opens a new
    // transaction after the bypass-only account lookup has completed.
    const fenced = await runWithTenant(account.organizationId, () =>
      withSocialMonitoringTenantCollectionFence(account.organizationId, async () => {

    const changes = entry.changes || entry.messaging || []
    for (const c of changes) {
      const value = c.value || c
      // Comment on feed / IG media
      if (value.item === "comment" || value.comment_id) {
        const commentId = value.comment_id || value.id
        if (!commentId) continue
        const text: string = value.message || value.comment || value.text || ""
        if (!text) continue
        const from = value.from || {}
        try {
          // Never accept parent relevance from a webhook payload. Resolve the
          // durable stored publication in this tenant before allowing a
          // negative parent to authorize complete comment capture.
          const parentPostUrl = value.post_permalink || null
          const postExternalId = value.post_id || value.media_id || null
          const parentContexts = parentPostUrl || postExternalId
            ? await parentMatchContextsForComments(
                account.organizationId,
                platform,
                parentPostUrl ? [parentPostUrl] : [],
                postExternalId ? [String(postExternalId)] : [],
              )
            : null
          const parentMatchContext = (postExternalId ? parentContexts?.get(String(postExternalId)) : null)
            ?? (parentPostUrl ? parentContexts?.get(parentPostUrl) : null)
            ?? null
          const replyToExternalId = postExternalId && value.parent_id && value.parent_id !== postExternalId
            ? value.parent_id
            : null
          const allSources = await prisma.monitoringSource.findMany({
            where: { organizationId: account.organizationId, platform, status: { in: ["active", "limited", "needs_setup"] } },
          })
          const linkedSources = allSources.filter((source: { id: string; handle: string | null; settings: unknown }) => {
            const settings = source.settings && typeof source.settings === "object" && !Array.isArray(source.settings)
              ? source.settings as Record<string, unknown>
              : {}
            const explicit = typeof settings.socialAccountId === "string" ? settings.socialAccountId : null
            return explicit ? explicit === account.id : source.handle === account.handle || source.handle === pageId
          })
          const routes = linkedSources.length > 0 ? await prisma.sourceRoutePlan.findMany({
            where: { organizationId: account.organizationId, sourceId: { in: linkedSources.map((source: { id: string }) => source.id) }, primaryAdapter: "META_GRAPH", status: { in: ["ACTIVE", "DEGRADED"] } },
            orderBy: { compiledAt: "desc" },
          }) : []
          const routeBySource = new Map<string, { id: string; capability: string; acquisitionMode: string }>()
          for (const route of routes) if (!routeBySource.has(route.sourceId)) routeBySource.set(route.sourceId, route)
          const deliveries = linkedSources.filter((source: { id: string }) => routeBySource.has(source.id))
          const targets: Array<{ sourceId: string | null; route: { id: string; capability: string; acquisitionMode: string } | null }> = deliveries.length > 0
            ? deliveries.map((source: { id: string }) => ({ sourceId: source.id, route: routeBySource.get(source.id) ?? null }))
            : [{ sourceId: null, route: null }]
          for (const target of targets) {
          // ingestMention with the pollers' "c:" externalId prefix so webhook-delivered
          // comments dedupe against poller/official-collector rows (tier 1) instead of
          // coexisting, and get sourceType="comment" + scenario matching + clustering.
          // sourceProvider "native": this is a comment on a CONNECTED own page — the
          // same row the FB/IG poller writes; "webhook" would flip the provider back
          // and forth between deliveries and ai-triage does not whitelist it.
          const result = await ingestMentionWithResult({
            organizationId: account.organizationId,
            accountId: account.id,
            platform,
            externalId: `c:${commentId}`,
            sourceType: replyToExternalId ? "reply" : "comment",
            contentKind: replyToExternalId ? "REPLY" : "COMMENT",
            postExternalId,
            parentExternalId: value.parent_id || value.post_id || value.media_id || null,
            threadExternalId: value.post_id || value.media_id || null,
            replyToExternalId,
            depth: replyToExternalId ? 1 : 0,
            canonicalUrl: value.permalink_url || value.comment_url || null,
            parentPostUrl,
            sourceProvider: "native",
            sourceMetadata: {
              monitoringSourceId: target.sourceId,
              routePlanId: target.route?.id ?? null,
              routeCapability: target.route?.capability ?? null,
              routeAdapter: "META_GRAPH",
              acquisitionMode: target.route?.acquisitionMode ?? "CONNECTED_ACCOUNT",
              officialWebhook: true,
            },
            text,
            sentiment: null,
            matchedTerm: findMatchedKeyword(text, account.keywords),
            authorName: from.name || null,
            authorHandle: from.username || from.id || null,
            publishedAt: parseMetaTime(value.created_time),
            ...(parentMatchContext ? { parentMatchContext } : {}),
            observation: {
              sourceId: target.sourceId,
              routePlanId: target.route?.id ?? null,
              adapterKey: "META_GRAPH",
              providerItemId: String(commentId),
              idempotencyKey: `meta-webhook:${target.sourceId ?? account.id}:${commentId}:${String(value.created_time ?? "initial")}`,
              acquisitionMode: target.route?.acquisitionMode ?? "CONNECTED_ACCOUNT",
              rawPayload: { object, entryId: pageId, change: c },
              policySnapshot: {
                version: "social-monitoring-v2-pr2",
                routePlanId: target.route?.id ?? null,
                capability: target.route?.capability ?? "READ_OWNED_COMMENTS",
                adapterKey: "META_GRAPH",
              },
            },
          })
          if (result.accepted !== false) {
            ingested++
            if (target.sourceId) {
              const permalink = value.permalink_url || value.comment_url || null
              const existing = await prisma.mentionEvidence.findFirst({
                where: { organizationId: account.organizationId, mentionId: result.id, sourceId: target.sourceId, ...(permalink ? { permalink } : {}) },
                select: { id: true },
              })
              if (!existing) await prisma.mentionEvidence.create({
                data: {
                  organizationId: account.organizationId,
                  mentionId: result.id,
                  sourceId: target.sourceId,
                  permalink,
                  rawSnippet: text,
                  rawPayload: { object, entryId: pageId, change: c },
                  confidence: 1,
                  sourceTrustTier: "T1",
                },
              })
            }
          }
          }
        } catch (e) {
          console.error("[meta-webhook] ingest failed:", e)
        }
      }
    }

      }),
    )
    if (!fenced.allowed) blocked += 1
  }

  return NextResponse.json({ success: true, ingested, ...(blocked > 0 ? { blocked } : {}) })
}
