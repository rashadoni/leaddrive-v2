import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { ensureConversation } from "@/lib/inbox-ensure-conversation"
import { notifyConversationRecipients } from "@/lib/social/notify-recipients"
import { normalizePhone } from "@/lib/phone"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { readRequestSecret, readSettingsSecret, webhookSecretMatches } from "@/lib/webhook-secret"

/**
 * Inbound SMS webhook — receives delivery & reply events from the SMS provider.
 * Handles STOP/UNSUBSCRIBE keywords to comply with CAN-SPAM / TCPA.
 *
 * The specific SMS provider (Twilio / Vonage / ATL) should be configured to POST
 * to this endpoint per organization. We identify the organization by `orgId` query
 * param (set in the provider's inbound URL) OR by a provider-specific secret header.
 *
 * Expected body (Twilio-style x-www-form-urlencoded or JSON):
 *   - From (E.164)
 *   - Body (text)
 *   - To (our number)
 *
 * Returns 200 with empty TwiML so Twilio doesn't retry.
 */

const STOP_KEYWORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "стоп", "отписаться"])

async function parseBody(req: NextRequest): Promise<Record<string, string>> {
  const ct = req.headers.get("content-type") || ""
  if (ct.includes("application/json")) {
    const j = await req.json().catch(() => null)
    return (j && typeof j === "object") ? (j as Record<string, string>) : {}
  }
  // Treat as form
  const text = await req.text()
  const params = new URLSearchParams(text)
  const out: Record<string, string> = {}
  for (const [k, v] of params) out[k] = v
  return out
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const orgId = searchParams.get("orgId")
  if (!orgId) return NextResponse.json({ error: "Missing orgId" }, { status: 400 })

  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true } })

  // F-26: `orgId` travels in the query string and authenticates nothing — it is
  // routing information, not a credential. Until this check existed, anyone
  // holding an organizationId could post fabricated inbound SMS into that
  // tenant's inbox. This is the "provider-specific secret header" the doc
  // comment at the top of this file has always described.
  //
  // Preference order: a per-channel secret is proper multi-tenant hygiene; a
  // deployment-wide secret is the weaker fallback that lets an existing
  // single-provider setup be secured with one env var. It is weaker because any
  // tenant who learns it can post against another tenant's orgId — so the
  // per-channel value wins whenever it is set.
  //
  // RLS: channel_configs is a tenant table and this lookup happens before any
  // tenant scope is entered, so it needs the bypass — exactly like the org
  // resolution in the vkontakte webhook.
  const channelSecret = org
    ? readSettingsSecret(
        (
          await runWithRlsBypass(() =>
            prisma.channelConfig.findFirst({
              where: { organizationId: orgId, channelType: "sms", isActive: true },
              select: { settings: true },
            })
          )
        )?.settings,
        "inboundSecret"
      )
    : null
  const expectedSecret = channelSecret ?? process.env.SMS_INBOUND_SECRET ?? null

  if (!expectedSecret) {
    console.error(
      "[sms-inbound] REJECTED: no inbound secret configured. Set settings.inboundSecret " +
      "on the org's sms channel, or SMS_INBOUND_SECRET for the deployment, and add the " +
      "same value as an x-webhook-secret header in the provider's inbound URL settings."
    )
    return NextResponse.json({ error: "Inbound webhook not configured" }, { status: 503 })
  }

  // The header is preferred, but a query parameter is accepted as a fallback:
  // regional SMS providers frequently cannot attach a custom header to their
  // inbound callback, and a fix that cannot be deployed protects nothing.
  //
  // The fallback is genuinely weaker — query strings end up in access logs,
  // proxy logs and browser history in a way headers do not — so it is a
  // deliberate second choice, not an equal one. Where the provider supports a
  // header, use the header. Whichever is used, the value is a shared secret the
  // provider stores, not a public identifier, which is the whole difference
  // from the `orgId`-only state this replaces.
  const providedSecret = readRequestSecret(req.headers) ?? searchParams.get("secret")

  // One response for both "unknown org" and "wrong secret": the previous 404
  // was an oracle telling a prober which organizationIds exist.
  if (!org || !webhookSecretMatches(providedSecret, expectedSecret)) {
    console.warn("[sms-inbound] REJECTED: unknown org or secret mismatch")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const data = await parseBody(req)
  const from = (data.From || data.from || data.msisdn || "").trim()
  const body = (data.Body || data.body || data.text || "").trim()
  const toNumber = (data.To || data.to || "").trim()
  // Provider message-id for idempotency (Twilio: MessageSid/SmsSid; ATL: may vary)
  const externalMsgId = (data.MessageSid || data.SmsSid || data.messageId || data.id || "").trim() || null

  if (!from || !body) return emptyTwimlResponse()

  // RLS: org was resolved from the provider-configured ?orgId param and verified against the
  // global organizations table above (no bypass needed — organizations carries no RLS policy).
  // ALL remaining handler work (unsubscribe + inbox ingest) runs tenant-scoped. The fire-and-
  // forget ingest IIFE below is started INSIDE this scope, so the ALS context follows it even
  // after the TwiML 200 is returned.
  return runWithTenant(orgId, async () => {

  const first = body.toLowerCase().split(/\s+/)[0] || ""
  if (STOP_KEYWORDS.has(first)) {
    // Suppress all future survey SMS to this number for this org
    try {
      const existing = await prisma.surveyUnsubscribe.findFirst({
        where: { organizationId: orgId, phone: from, surveyId: null },
      })
      if (!existing) {
        await prisma.surveyUnsubscribe.create({
          data: { organizationId: orgId, phone: from, surveyId: null, reason: "sms_stop" },
        })
      }
      console.log(`[sms-inbound] STOP from ${from} for org ${orgId}`)
    } catch (e) {
      console.error("[sms-inbound] unsubscribe failed:", e)
    }
    // STOP replies are compliance events — do NOT ingest into inbox
    return emptyTwimlResponse()
  }

  // A2 — ingest non-STOP inbound SMS into the unified inbox so the thread appears in the Inbox UI.
  // Fire-and-forget: never delays the TwiML 200 response to the provider.
  ;(async () => {
    try {
      // Idempotency guard 1/2 (sequential retries): skip if we already ingested this
      // provider message-id. The partial UNIQUE index on (organizationId, externalId)
      // — WHERE direction='inbound' AND channelType IN ('sms','email') — is guard 2/2
      // for the CONCURRENT-retry race the catch below handles.
      if (externalMsgId) {
        const existing = await prisma.channelMessage.findFirst({
          where: { organizationId: orgId, externalId: externalMsgId },
          select: { id: true },
        })
        if (existing) return
      }

      // Resolve contact by phone (E.164 exact, digits-only stripped, and +stripped variants)
      const normalized = normalizePhone(from)
      const contact = await prisma.contact.findFirst({
        where: {
          organizationId: orgId,
          OR: [{ phone: from }, { phone: normalized }, { phone: `+${normalized}` }],
        },
        select: { id: true },
      })

      const msg = await prisma.channelMessage.create({
        data: {
          organizationId: orgId,
          direction: "inbound",
          channelType: "sms",
          from,
          to: toNumber,
          body,
          externalId: externalMsgId ?? undefined,
          contactId: contact?.id ?? undefined,
        },
      })

      const conv = await ensureConversation(orgId, {
        channel: "sms",
        contactId: contact?.id ?? null,
        contactPhone: from,
        reopenOnInbound: true,
        messageIds: [msg.id],
      })

      await notifyConversationRecipients(orgId, conv.id, conv.assignedTo, {
        type: "info",
        title: "New SMS",
        message: `Inbound SMS from ${from}`,
        entityType: "inbox_message",
        entityId: conv.id,
        kind: "inbox.message",
      })
      try {
        const { emitConversationIngestEvents } = await import("@/lib/inbox/conversation-events")
        await emitConversationIngestEvents({ organizationId: orgId, conversationId: conv.id, wasCreated: conv.wasCreated })
      } catch (eventError) {
        console.error("[sms-inbound] conversation flow event failed:", eventError)
      }
    } catch (e) {
      // P2002 = a concurrent provider retry lost the unique-index race; the winning
      // request already ingested this externalId. Expected idempotent outcome, not a
      // failure — skip quietly instead of logging a scary error.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return
      }
      console.error("[sms-inbound] inbox-ingest failed:", e)
    }
  })()

  return emptyTwimlResponse()

  }) // end runWithTenant (tenant-scoped handler body)
}

function emptyTwimlResponse(): NextResponse {
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
    status: 200,
    headers: { "Content-Type": "application/xml" },
  })
}
