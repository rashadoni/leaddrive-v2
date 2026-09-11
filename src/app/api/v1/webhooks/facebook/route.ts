import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { upsertSocialConversation } from "@/lib/facebook"
import { notifyConversationRecipients } from "@/lib/social/notify-recipients"
import { isIgLogin } from "@/lib/social/tenant-meta-app"
import { resolveMetaSenderName } from "@/lib/social/meta-sender-profile"
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"
import type { ChannelConfig } from "@prisma/client"
import { createHmac, timingSafeEqual } from "crypto"
import {
  rankInboundChannels,
  reportInboundAmbiguity,
  type MetaSurface,
} from "@/lib/social/inbound-channel-ranking"
import {
  handleInstagramInboundAudio,
  parseInstagramAttachment,
} from "@/lib/social/instagram-inbound-audio"

const VERIFY_TOKEN = process.env.FACEBOOK_VERIFY_TOKEN

/**
 * Model B (per-tenant Meta app) — resolve a tenant's FB/IG webhook creds by the `?t=<org-slug>`
 * param their own Meta app appends to its callback URL. Returns the tenant's verifyToken (GET
 * handshake) + appSecret (POST signature). Null when the slug is absent/unknown → caller falls
 * back to env (LeadDrive's own shared app). Mirrors resolveTenantWhatsAppConfig.
 */
async function resolveTenantFacebookConfig(
  slug: string | null,
): Promise<{ organizationId: string; verifyToken: string | null; appSecret: string | null } | null> {
  if (!slug) return null
  // RLS: org resolution by external identifier (?t slug → org → app-config row) is the cross-tenant
  // phase — runs under bypass. Everything downstream is scoped via runWithTenant.
  return runWithRlsBypass(async () => {
    const org = await prisma.organization.findUnique({ where: { slug }, select: { id: true } })
    if (!org) return null
    // Resolve the tenant's META-APP config row — the one carrying their own appSecret + verifyToken,
    // NOT a per-page token row. Requiring BOTH `appSecret` AND `verifyToken` non-null is the discriminator:
    //  - Model B app-config rows (manual entry) carry appSecret + verifyToken.
    //  - OAuth-created page rows are token carriers (no appSecret post-fix; never had a verifyToken).
    //  - Historical env-polluted page rows (old code stamped env appSecret) have NO verifyToken → excluded
    //    here at read time, so they can never resolve the env secret for a `?t=<slug>` POST. This closes
    //    the Codex finding WITHOUT a data migration (a leftover env-secret page row is simply ignored).
    // Exclude Instagram-Login (Path B) app-config rows (channelType=instagram + settings.igLogin=true):
    // those belong to the tenant's SEPARATE IG-Login Meta app, so a FB ?t handshake/signature must never
    // verify against them. The igLogin filter is in JS (not a Prisma `NOT { path equals true }`, which is
    // NOT NULL-safe — it would wrongly exclude FB rows whose settings lacks the key; verified prisma#7836).
    const cfgs = await prisma.channelConfig.findMany({
      where: {
        organizationId: org.id,
        channelType: { in: ["facebook", "instagram"] },
        isActive: true,
        appSecret: { not: null },
        verifyToken: { not: null },
      },
      select: { verifyToken: true, appSecret: true, settings: true },
      orderBy: { updatedAt: "desc" },
    })
    const cfg = cfgs.find((c: { verifyToken: string | null; appSecret: string | null; settings: unknown }) => !isIgLogin(c.settings))
    return { organizationId: org.id, verifyToken: cfg?.verifyToken ?? null, appSecret: cfg?.appSecret ?? null }
  })
}

/**
 * Verify Meta's X-Hub-Signature-256 over the RAW body using the app secret. In Model B each tenant's
 * own Meta app signs with ITS OWN secret (passed in via the per-tenant ?t lookup); LeadDrive's shared
 * app falls back to env FACEBOOK_APP_SECRET. If no secret is resolvable, fail closed unless an explicit
 * non-production bypass is enabled for local/dev testing. This endpoint writes inbound DMs into tenant
 * inboxes, so a forged payload would inject messages + fire notifications/auto-reply for any pageId.
 */
function allowUnsignedMetaWebhook(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.ALLOW_UNSIGNED_META_WEBHOOKS === "1"
}

function verifyFacebookSignature(rawBody: string, signatureHeader: string | null, secret: string | null): boolean {
  const key = secret || process.env.FACEBOOK_APP_SECRET
  if (!key) return allowUnsignedMetaWebhook()
  if (!signatureHeader) return false
  const expected = "sha256=" + createHmac("sha256", key).update(rawBody).digest("hex")
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader))
  } catch {
    return false
  }
}

/**
 * Deterministic inbound-channel resolution for a pageId. The order itself (and why it is oldest-claim-first)
 * lives in `lib/social/inbound-channel-ranking.ts`, shared with /api/v1/webhooks/instagram and with the
 * channel settings screen that warns a tenant whose claim loses.
 *
 * RLS: this lookup IS the org resolution (pageId is an external identifier) → runs under bypass.
 * Everything downstream of it runs inside `runWithTenant(channel.organizationId)`.
 */
async function resolveInboundChannel({
  orgScope,
  pageId,
  channelTypes,
  platform,
}: {
  orgScope: { organizationId?: string }
  pageId: string
  channelTypes: MetaSurface[]
  platform: MetaSurface
}): Promise<ChannelConfig | null> {
  if (!pageId) return null
  const rows = await runWithRlsBypass(() =>
    prisma.channelConfig.findMany({
      where: { ...orgScope, pageId, channelType: { in: channelTypes }, isActive: true },
      // Stable base order at the DB too — the JS ranking is the authority, but an ORDER BY keeps the
      // query itself reproducible (and keeps a future `take` honest).
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  )
  const ranked = rankInboundChannels(Array.isArray(rows) ? rows : [], platform, "facebookLogin")
  reportInboundAmbiguity("[FB Webhook]", pageId, platform, ranked, "facebookLogin")
  return ranked[0] ?? null
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const mode = searchParams.get("hub.mode")
  const token = searchParams.get("hub.verify_token")
  const challenge = searchParams.get("hub.challenge")

  // Per-tenant: their own Meta app's callback URL carries ?t=<org-slug>; verify against the tenant's
  // own verifyToken. CRITICAL: when ?t IS present we use ONLY the tenant's own verifyToken — never the
  // env fallback (else LeadDrive's env token could verify another tenant's subscription by slug). Only
  // the no-?t path (LeadDrive's own shared app) uses env VERIFY_TOKEN.
  const slug = searchParams.get("t")
  const tenant = await resolveTenantFacebookConfig(slug)
  const expectedVerify = slug ? (tenant?.verifyToken || null) : VERIFY_TOKEN
  if (!expectedVerify) {
    // slug set but tenant has no verifyToken → 403 (don't env-fallback); no slug + no env → 500
    return NextResponse.json(
      { error: slug ? "Forbidden" : "Server misconfigured" },
      { status: slug ? 403 : 500 },
    )
  }
  if (mode === "subscribe" && token === expectedVerify) {
    return new NextResponse(challenge, { status: 200 })
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 })
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text()
    // Per-tenant: verify the signature with the tenant's OWN appSecret (resolved from ?t=<org-slug>).
    // CRITICAL: when ?t IS present, the tenant's own appSecret is the ONLY acceptable signer — we do
    // NOT fall back to env. Otherwise an env-signed (LeadDrive shared-app) payload addressed to ?t=<any
    // org slug> would pass AND be org-scoped to that org → a cross-tenant write. Only the no-?t path
    // (LeadDrive's own shared app) uses the env appSecret. Mirrors WhatsApp's tenant-declared guard.
    const { searchParams } = req.nextUrl
    const slug = searchParams.get("t")
    const tenant = await resolveTenantFacebookConfig(slug)
    if (slug && !tenant?.appSecret) {
      console.error(`[FB Webhook] POST: ?t=${slug} addressed but tenant has no appSecret — refusing env fallback`)
      return NextResponse.json({ error: "Invalid signature" }, { status: 403 })
    }
    if (!verifyFacebookSignature(rawBody, req.headers.get("x-hub-signature-256"), tenant?.appSecret ?? null)) {
      console.error("[FB Webhook] POST: invalid signature")
      return NextResponse.json({ error: "Invalid signature" }, { status: 403 })
    }
    const body = JSON.parse(rawBody)
    if (body.object !== "page" && body.object !== "instagram") {
      return NextResponse.json({ ok: true })
    }

    // Cross-tenant isolation: when the tenant is resolved from ?t=<slug> (their own Meta app), the
    // inbound channel lookup MUST be scoped to that org. pageId is NOT unique across tenants, so an
    // un-scoped global lookup would let tenant B (who stored tenant A's public Page ID) receive A's
    // signed messages. The env/LeadDrive shared-app path (no ?t) keeps the global lookup. Mirrors the
    // WhatsApp webhook's org-scoping.
    const orgScope = tenant?.organizationId ? { organizationId: tenant.organizationId } : {}
    const platform: MetaSurface = body.object === "instagram" ? "instagram" : "facebook"

    for (const entry of body.entry || []) {
      const pageId = entry.id
      // Find channel config by pageId (org-scoped when a tenant ?t was resolved + verified). When more
      // than one org claims the pageId the winner is picked by a total order + warned about — see
      // resolveInboundChannel.
      let channel = await resolveInboundChannel({
        orgScope,
        pageId,
        channelTypes: ["facebook", "instagram"],
        platform,
      })
      // Instagram DMs (object: instagram) may key entry.id on the IG-scoped id, which can differ from
      // the stored instagram_business_account.id. Fall back to the message recipient (the business
      // account that received the DM) before dropping, and log an unresolved IG entry so the id can be
      // reconciled from a real payload.
      if (!channel && body.object === "instagram") {
        const recipientId = (entry.messaging || [])[0]?.recipient?.id
        if (recipientId && recipientId !== pageId) {
          channel = await resolveInboundChannel({
            orgScope,
            pageId: recipientId,
            channelTypes: ["instagram"],
            platform,
          })
        }
        if (!channel) console.warn(`[FB Webhook] unresolved IG entry — entry.id=${pageId} recipient=${recipientId ?? "?"}`)
      }
      if (!channel) continue

      // RLS: org resolved — ALL remaining per-entry work runs tenant-scoped.
      await runWithTenant(channel.organizationId, async () => {

      for (const event of entry.messaging || []) {
        if (event.message?.is_echo) continue // skip echoes
        const senderId = event.sender?.id
        const text = event.message?.text || "[media]"
        const { mediaUrl, messageType } = parseInstagramAttachment(event.message?.attachments)
        const externalMessageId =
          typeof event.message?.mid === "string" && event.message.mid.trim()
            ? event.message.mid.trim()
            : null

        if (!senderId) continue
        if (externalMessageId) {
          const duplicate = await prisma.channelMessage.findFirst({
            where: {
              organizationId: channel.organizationId,
              channelType: platform,
              direction: "inbound",
              externalId: externalMessageId,
            },
            select: { id: true },
          })
          if (duplicate) continue
        }

        const senderName = await resolveMetaSenderName({
          organizationId: channel.organizationId, platform, senderId,
          token: channel.apiKey, igLogin: isIgLogin(channel.settings),
        })
        const conv = await upsertSocialConversation(
          channel.organizationId, platform, senderId,
          senderName, text, channel.id
        )

        const messageMetadata = { senderId, pageId, platform }
        const inboundMessage = await prisma.channelMessage.create({
          data: {
            organizationId: channel.organizationId,
            channelConfigId: channel.id,
            channelType: platform,
            direction: "inbound",
            from: senderId,
            to: pageId,
            body: text,
            status: "delivered",
            externalId: externalMessageId,
            mediaUrl,
            messageType: messageType || "text",
            conversationId: conv.id,
            metadata: messageMetadata,
          },
        })

        // Phase 2b + collaborators — notify the assignee AND every internal participant (deduped).
        // Fail-soft, never blocks the 200 owed to Meta.
        notifyConversationRecipients(channel.organizationId, conv.id, conv.assignedTo, {
          type: "info",
          title: "New message",
          message: `New message in ${platform}`,
          entityType: "inbox_message",
          entityId: conv.id,
          kind: "inbox.message",
        }).catch(() => {})
        try {
          const { emitConversationIngestEvents } = await import("@/lib/inbox/conversation-events")
          await emitConversationIngestEvents({ organizationId: channel.organizationId, conversationId: conv.id, wasCreated: conv.wasCreated })
        } catch (e) {
          console.error("[FB Webhook] conversation flow event failed:", e)
        }

        // Phase 7 slice-2 — inbound chatbot auto-reply (fb/ig). DORMANT unless the org
        // opts in (features.chatbotAutoReply); only on real text (not the [media]
        // fallback); isolated try so it never blocks the 200 owed to Meta.
        const replyMode = (channel.settings as { replyMode?: string } | null)?.replyMode ?? "agent"
        // The page / IG access token this channel replies with. Nullable on the row (a config can be
        // created before its token is stored), and an outbound send without one only errors at Graph —
        // so the auto-reply paths below require it rather than passing null through.
        const outboundToken = channel.apiKey
        if (event.message?.text?.trim()) {
          try {
            const { maybeAutoReply, chatbotTookOwnership } = await import("@/lib/chatbot-autoreply")
            const r = await maybeAutoReply({
              orgId: channel.organizationId, channelType: platform,
              conversationId: conv.id, inboundText: text, to: senderId,
            })
            // AI fallback — only when the rules-bot didn't own it, the org opted into aiAutoReply,
            // AND this channel is set to "ai" in the per-channel matrix (settings.replyMode; default
            // "agent" = no AI). The replyMode gate means the org-wide aiAutoReply flag alone no longer
            // auto-replies on FB/IG — each channel is opted in individually, same as TikTok.
            if (replyMode === "ai" && outboundToken && !chatbotTookOwnership(r)) {
              const { maybeAiAutoReply } = await import("@/lib/social/ai-autoreply")
              const { sendFacebookMessage, sendInstagramMessage } = await import("@/lib/facebook")
              await maybeAiAutoReply({
                orgId: channel.organizationId, channelConfigId: channel.id, platform,
                conversationId: conv.id, pageId, externalId: senderId, userMessage: text, senderName: senderId,
                send: (txt) =>
                  platform === "instagram"
                    ? sendInstagramMessage(senderId, txt, outboundToken, channel.organizationId)
                    : sendFacebookMessage(senderId, txt, outboundToken, channel.organizationId),
              })
            }
          } catch (e) {
            console.error("[FB Webhook] auto-reply failed:", e)
          }
        } else if (platform === "instagram" && messageType === "audio" && mediaUrl && replyMode === "ai" && outboundToken) {
          const { sendInstagramMessage } = await import("@/lib/facebook")
          const send = (reply: string) =>
            sendInstagramMessage(senderId, reply, outboundToken, channel.organizationId)
          await handleInstagramInboundAudio({
            organizationId: channel.organizationId,
            messageId: inboundMessage.id,
            audioUrl: mediaUrl,
            metadata: messageMetadata,
            sendFallback: send,
            onTranscript: async (transcript) => {
              const { maybeAutoReply, chatbotTookOwnership } = await import("@/lib/chatbot-autoreply")
              const ruleResult = await maybeAutoReply({
                orgId: channel.organizationId,
                channelType: "instagram",
                conversationId: conv.id,
                inboundText: transcript,
                to: senderId,
              })
              if (!chatbotTookOwnership(ruleResult)) {
                const { maybeAiAutoReply } = await import("@/lib/social/ai-autoreply")
                await maybeAiAutoReply({
                  orgId: channel.organizationId,
                  channelConfigId: channel.id,
                  platform: "instagram",
                  conversationId: conv.id,
                  pageId,
                  externalId: senderId,
                  userMessage: transcript,
                  senderName: senderId,
                  send,
                })
              }
            },
          })
        }
      }
      }) // end runWithTenant (per-entry tenant scope)
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error("Facebook webhook error:", e)
    return NextResponse.json({ ok: true }) // always 200 to Meta
  }
}
