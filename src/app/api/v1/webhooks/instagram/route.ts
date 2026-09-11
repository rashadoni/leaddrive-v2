import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { upsertSocialConversation } from "@/lib/facebook"
import { notifyConversationRecipients } from "@/lib/social/notify-recipients"
import { resolveMetaSenderName } from "@/lib/social/meta-sender-profile"
import { isIgLogin } from "@/lib/social/tenant-meta-app"
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"
import { createHmac, timingSafeEqual } from "crypto"
import type { ChannelConfig } from "@prisma/client"
import {
  handleInstagramInboundAudio,
  parseInstagramAttachment,
} from "@/lib/social/instagram-inbound-audio"

/**
 * Instagram-Login webhook ("Path B" — "Instagram API with Instagram Login").
 *
 * SEPARATE from the Facebook-Login webhook (webhooks/facebook). The Instagram-Login app is a distinct
 * Meta app with its own callback URL, verify token, and app secret, so signatures are verified with
 * INSTAGRAM_APP_SECRET (not FACEBOOK_APP_SECRET). Inbound DMs resolve the per-tenant Instagram-Login
 * ChannelConfig (settings.igLogin=true, pageId = the IG user id from oauth/instagram/callback) and
 * replies go back out via graph.instagram.com (sendInstagramLoginMessage).
 *
 * Required env: INSTAGRAM_WEBHOOK_VERIFY_TOKEN, INSTAGRAM_APP_SECRET.
 * Dashboard: Use Cases > "Manage messages and content in Instagram" > Webhooks — set the callback URL
 * to /api/v1/webhooks/instagram and the verify token to INSTAGRAM_WEBHOOK_VERIFY_TOKEN, subscribe the
 * `messages` field. (Meta requires the app to be PUBLISHED for IG webhook delivery.)
 */
const VERIFY_TOKEN = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN

/**
 * Model B (per-tenant IG-Login Meta app) — resolve a tenant's IG-Login webhook creds by the
 * `?t=<org-slug>` their own app appends to its callback URL. Returns the tenant's verifyToken (GET
 * handshake) + appSecret (POST signature) from their IG-Login app-config row (channelType=instagram,
 * settings.igLogin=true, carrying the app triple). Requiring appSecret+verifyToken non-null excludes
 * the OAuth-created IG-Login token rows (pageId+token only). Null when slug absent/unknown → caller
 * falls back to env (LeadDrive's shared IG-Login app). Mirrors resolveTenantFacebookConfig.
 */
async function resolveTenantInstagramLoginConfig(
  slug: string | null,
): Promise<{ organizationId: string; verifyToken: string | null; appSecret: string | null } | null> {
  if (!slug) return null
  // RLS: org resolution by external identifier (?t slug → org → IG-Login app-config row) is the
  // cross-tenant phase — runs under bypass. Everything downstream is scoped via runWithTenant.
  return runWithRlsBypass(async () => {
    const org = await prisma.organization.findUnique({ where: { slug }, select: { id: true } })
    if (!org) return null
    const cfg = await prisma.channelConfig.findFirst({
      where: {
        organizationId: org.id,
        channelType: "instagram",
        isActive: true,
        appSecret: { not: null },
        verifyToken: { not: null },
        settings: { path: ["igLogin"], equals: true },
      },
      select: { verifyToken: true, appSecret: true },
      orderBy: { updatedAt: "desc" },
    })
    return { organizationId: org.id, verifyToken: cfg?.verifyToken ?? null, appSecret: cfg?.appSecret ?? null }
  })
}

function verifyIgSignature(rawBody: string, signatureHeader: string | null, secret: string | null): boolean {
  const key = secret || process.env.INSTAGRAM_APP_SECRET
  if (!key) {
    return process.env.NODE_ENV !== "production" && process.env.ALLOW_UNSIGNED_META_WEBHOOKS === "1"
  }
  if (!signatureHeader) return false
  const expected = "sha256=" + createHmac("sha256", key).update(rawBody).digest("hex")
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader))
  } catch {
    return false
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const mode = searchParams.get("hub.mode")
  const token = searchParams.get("hub.verify_token")
  const challenge = searchParams.get("hub.challenge")

  // Per-tenant: their own IG-Login app's callback URL carries ?t=<org-slug>; verify against the
  // tenant's own verifyToken ONLY (no env fallback when ?t is present — else LeadDrive's env token
  // could verify another tenant's subscription by slug). No ?t → env (LeadDrive's shared app).
  const slug = searchParams.get("t")
  const tenant = await resolveTenantInstagramLoginConfig(slug)
  const expectedVerify = slug ? (tenant?.verifyToken || null) : VERIFY_TOKEN
  if (!expectedVerify) {
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
    // Per-tenant: verify with the tenant's OWN IG-Login appSecret (resolved from ?t=<org-slug>). When ?t
    // addresses a tenant with no own secret, REJECT — never env-fallback (else an env-signed payload to
    // ?t=<any slug> would pass + be org-scoped → cross-tenant write). No ?t → env (LeadDrive shared app).
    const { searchParams } = req.nextUrl
    const slug = searchParams.get("t")
    const tenant = await resolveTenantInstagramLoginConfig(slug)
    if (slug && !tenant?.appSecret) {
      console.error(`[IG Webhook] POST: ?t=${slug} addressed but tenant has no appSecret — refusing env fallback`)
      return NextResponse.json({ error: "Invalid signature" }, { status: 403 })
    }
    if (!verifyIgSignature(rawBody, req.headers.get("x-hub-signature-256"), tenant?.appSecret ?? null)) {
      console.error("[IG Webhook] POST: invalid signature")
      return NextResponse.json({ error: "Invalid signature" }, { status: 403 })
    }
    const body = JSON.parse(rawBody)
    if (body.object !== "instagram") {
      return NextResponse.json({ ok: true })
    }

    // Cross-tenant isolation: when a tenant is resolved+verified via ?t, scope the inbound channel
    // lookup to that org (pageId/IG-user-id is not unique across tenants). No ?t → global (LeadDrive
    // shared-app path), as before.
    const orgScope = tenant?.organizationId ? { organizationId: tenant.organizationId } : {}

    for (const entry of body.entry || []) {
      // IG-Login webhook: entry.id is the IG business account id; messaging[].recipient.id matches it.
      // Resolve the per-tenant Instagram-Login ChannelConfig by pageId (= the IG user id stored at
      // connect). Prefer the igLogin row if both an IG-Login and a legacy FB-Login row exist.
      const igAccountId = entry.id
      const recipientId = (entry.messaging || [])[0]?.recipient?.id
      // RLS: this lookup IS the org resolution (IG account id is an external identifier) → bypass scope.
      const candidates = await runWithRlsBypass(() =>
        prisma.channelConfig.findMany({
          where: {
            ...orgScope,
            channelType: "instagram",
            isActive: true,
            pageId: { in: [igAccountId, recipientId].filter(Boolean) as string[] },
          },
        })
      )
      const channel =
        candidates.find((c: ChannelConfig) => {
          const s = c.settings as Record<string, unknown> | null
          return s && typeof s === "object" && (s as { igLogin?: boolean }).igLogin === true
        }) || candidates[0]
      if (!channel) {
        console.warn(`[IG Webhook] unresolved IG entry — entry.id=${igAccountId} recipient=${recipientId ?? "?"}`)
        continue
      }

      // RLS: org resolved — ALL remaining per-entry work runs tenant-scoped.
      await runWithTenant(channel.organizationId, async () => {
      for (const event of entry.messaging || []) {
        if (event.message?.is_echo) continue // skip our own echoes
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
              channelType: "instagram",
              direction: "inbound",
              externalId: externalMessageId,
            },
            select: { id: true },
          })
          if (duplicate) continue
        }

        const senderName = await resolveMetaSenderName({
          organizationId: channel.organizationId, platform: "instagram", senderId,
          token: channel.apiKey, igLogin: isIgLogin(channel.settings),
        })
        const conv = await upsertSocialConversation(
          channel.organizationId, "instagram", senderId, senderName, text, channel.id,
        )

        const messageMetadata = { senderId, igAccountId, platform: "instagram", igLogin: true }
        const inboundMessage = await prisma.channelMessage.create({
          data: {
            organizationId: channel.organizationId,
            channelConfigId: channel.id,
            channelType: "instagram",
            direction: "inbound",
            from: senderId,
            to: igAccountId,
            body: text,
            status: "delivered",
            externalId: externalMessageId,
            mediaUrl,
            messageType: messageType || "text",
            conversationId: conv.id,
            metadata: messageMetadata,
          },
        })

        // Collaborators — notify the assignee AND every internal participant (deduped). Fail-soft.
        notifyConversationRecipients(channel.organizationId, conv.id, conv.assignedTo, {
          type: "info",
          title: "New message",
          message: "New message in instagram",
          entityType: "inbox_message",
          entityId: conv.id,
          kind: "inbox.message",
        }).catch(() => {})
        try {
          const { emitConversationIngestEvents } = await import("@/lib/inbox/conversation-events")
          await emitConversationIngestEvents({ organizationId: channel.organizationId, conversationId: conv.id, wasCreated: conv.wasCreated })
        } catch (e) {
          console.error("[IG Webhook] conversation flow event failed:", e)
        }

        // Inbound auto-reply (rules-bot, then AI fallback) — mirrors the Facebook webhook. Both are
        // org-opt-in (chatbotAutoReply / aiAutoReply), text-only, and isolated so a failure never
        // blocks the 200 owed to Meta. The AI reply sends via the Instagram-Login token.
        const replyMode = (channel.settings as { replyMode?: string } | null)?.replyMode ?? "agent"
        if (event.message?.text?.trim()) {
          try {
            const { maybeAutoReply, chatbotTookOwnership } = await import("@/lib/chatbot-autoreply")
            const r = await maybeAutoReply({
              orgId: channel.organizationId, channelType: "instagram",
              conversationId: conv.id, inboundText: text, to: senderId,
            })
            // Gate AI on the per-channel matrix (settings.replyMode; default "agent" = no AI) so the
            // org-wide aiAutoReply flag alone no longer auto-replies on Instagram — opt in per channel.
            if (replyMode === "ai" && !chatbotTookOwnership(r)) {
              const { maybeAiAutoReply } = await import("@/lib/social/ai-autoreply")
              const { sendInstagramLoginMessage } = await import("@/lib/social/instagram-login")
              const igToken = channel.apiKey
              await maybeAiAutoReply({
                orgId: channel.organizationId, channelConfigId: channel.id, platform: "instagram",
                conversationId: conv.id, pageId: igAccountId, externalId: senderId, userMessage: text, senderName: senderId,
                send: (txt) => sendInstagramLoginMessage(senderId, txt, igToken || ""),
              })
            }
          } catch (e) {
            console.error("[IG Webhook] auto-reply failed:", e)
          }
        } else if (messageType === "audio" && mediaUrl && replyMode === "ai") {
          const { sendInstagramLoginMessage } = await import("@/lib/social/instagram-login")
          const send = (reply: string) => sendInstagramLoginMessage(senderId, reply, channel.apiKey || "")
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
                  pageId: igAccountId,
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
    console.error("Instagram webhook error:", e)
    return NextResponse.json({ ok: true }) // always 200 to Meta
  }
}
