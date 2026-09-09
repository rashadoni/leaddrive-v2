import { NextRequest, NextResponse } from "next/server"
import { createHash } from "crypto"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"
import { checkRateLimit, RATE_LIMIT_CONFIG } from "@/lib/rate-limit"
import {
  mapThreeCxCallType,
  parseThreeCxDateTime,
  parseThreeCxDuration,
  resolveThreeCxConfig,
  threeCxPhoneVariants,
} from "@/lib/voip/threecx-crm"
import { normalizeManualLeadPhone } from "@/lib/voice-agent/manual-lead-call"
import { matchCallParty } from "@/lib/calls/party-match"

/**
 * POST /api/v1/calls/webhook/threecx?orgId=xxx&secret=yyy — call events from 3CX.
 *
 * Two payload shapes are accepted:
 *
 *  1. CRM-template journaling (what 3CX actually drives on v20): the `ReportCall`
 *     scenario of the server-side CRM template fires once when a call ENDS and
 *     posts url-encoded `PostValues` — callType/number/agent/duration/dateTime/
 *     entityId. One POST = one finished call, so the whole CallLog + Activity is
 *     written in a single request.
 *
 *  2. Per-event pushes (`call.ringing` / `call.answered` / `call.ended` /
 *     `call.missed`) for setups driving this endpoint from the Call Control API
 *     WebSocket or a custom relay. Kept for backwards compatibility.
 *
 * Auth: the per-org secret is MANDATORY. It used to be skipped when the org had
 * no secret configured, which let anyone holding an orgId write call history into
 * that tenant — closed here; setups without a secret now get 401 and must
 * generate one in Settings → Telephony.
 */
export async function POST(req: NextRequest) {
  try {
    const orgId = req.nextUrl.searchParams.get("orgId")
    const secret = req.nextUrl.searchParams.get("secret")

    if (!orgId) {
      return NextResponse.json({ error: "Missing orgId" }, { status: 400 })
    }
    if (!secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (!checkRateLimit(`threecx-webhook:${orgId}`, RATE_LIMIT_CONFIG.webhook)) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 })
    }

    // RLS: channelConfig is a tenant table — with no request context the lookup
    // would return null under RLS and the secret gate below could never pass.
    // This lookup IS the org-resolution/secret fetch for the ?orgId query param
    // → bypass scope, this query only.
    // ALL voip rows are read: an org that switched provider keeps the old row,
    // and only the row owning the secret may authorise the request. Picking one
    // row by ordering let a leftover Twilio config answer for 3CX and 401 every
    // call.
    const voipConfigs = await runWithRlsBypass(() =>
      prisma.channelConfig.findMany({
        where: { organizationId: orgId, channelType: "voip" },
        select: { id: true, isActive: true, settings: true },
      })
    )

    const auth = resolveThreeCxConfig(voipConfigs, secret)
    if (auth.status === "disabled") {
      return NextResponse.json({ error: "VoIP integration is disabled" }, { status: 403 })
    }
    if (auth.status !== "ok") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const voipConfig = auth.config

    const body = await readBody(req)
    const eventType = String(body.event ?? body.type ?? body.Event ?? "").trim()

    // The journaling payload is identified by its `callType` field (the template
    // also sends event=ReportCall, but a hand-written template may omit it).
    const isReportCall =
      eventType.toLowerCase() === "reportcall" ||
      typeof pick(body, "callType", "CallType") === "string"

    // RLS: org resolved and secret-gated above — ALL handler work (contact/lead
    // match, callLog writes, activity creation) runs tenant-scoped.
    return await runWithTenant(orgId, async () => {
      if (isReportCall) {
        return await handleReportCall(orgId, voipConfig?.id ?? null, body)
      }
      return await handleCallEvent(orgId, eventType, body)
    })
  } catch (err) {
    console.error("[3CX Webhook] Error:", err)
    // Always 200 to the PBX: 3CX has no retry queue worth triggering, and a 5xx
    // here just fills its event log.
    return NextResponse.json({ ok: true })
  }
}

// ── payload helpers ────────────────────────────────────────────────────────

/**
 * 3CX posts `PostValues` as application/x-www-form-urlencoded; hand-rolled
 * templates may post JSON instead. Read the body ONCE and parse either shape.
 */
async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  const contentType = (req.headers.get("content-type") || "").toLowerCase()

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData()
    return Object.fromEntries(
      [...form.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""]),
    )
  }

  const raw = await req.text()
  if (!raw.trim()) return {}

  if (contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(raw))
  }

  // No usable content-type — try JSON, fall back to urlencoded.
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>
  } catch {
    /* not JSON */
  }
  return Object.fromEntries(new URLSearchParams(raw))
}

function pick(body: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = body[key]
    if (value !== undefined && value !== null && String(value).trim() !== "") return value
  }
  return undefined
}

function str(value: unknown): string {
  return value === undefined || value === null ? "" : String(value).trim()
}

// ── CRM-template journaling (ReportCall) ───────────────────────────────────

async function handleReportCall(
  orgId: string,
  channelConfigId: string | null,
  body: Record<string, unknown>,
): Promise<NextResponse> {
  const externalNumber = str(pick(body, "number", "Number", "callerNumber"))
  const agent = str(pick(body, "agent", "Agent", "extension", "Extension"))
  const callTypeRaw = str(pick(body, "callType", "CallType"))
  const displayName = str(pick(body, "name", "Name"))

  if (!externalNumber) {
    console.warn(`[3CX Webhook] ReportCall without a number, org: ${orgId}`)
    return NextResponse.json({ ok: true, skipped: "missing-number" })
  }

  const callMapping = mapThreeCxCallType(callTypeRaw)
  if (!callMapping) {
    console.warn(`[3CX Webhook] ReportCall with unsupported call type, org: ${orgId}`)
    return NextResponse.json({ ok: true, skipped: "unsupported-call-type" })
  }

  const { direction, status, answered } = callMapping
  const duration = parseThreeCxDuration(pick(body, "duration", "Duration"))
  const startedAt =
    parseThreeCxDateTime(
      pick(body, "dateTime", "DateTime", "callStartTimeLocal", "CallStartTimeLocal"),
    ) ?? new Date()

  // 3CX gives the journaling scenario no call identifier, so the idempotency key
  // is derived from the call's own fields. A repeat POST for the same call (a 3CX
  // retry, or the template re-firing) hashes identically and is rejected by the
  // CallEvent unique index instead of duplicating call history.
  //
  // The call's start time is what separates two calls that are otherwise
  // identical — same caller, same extension, both missed, both zero-length.
  // If a template variant omits [DateTime] we fall back to arrival time at
  // second precision rather than dropping the timestamp from the key: without
  // it, a second missed call from the same number would look like a duplicate
  // and be silently discarded, and losing a real missed call costs the owner
  // more than an occasional duplicate row.
  const reportedAt = str(pick(body, "dateTime", "DateTime"))
  const timeKey = reportedAt || `received:${Math.floor(Date.now() / 1000)}`
  const fingerprint = createHash("sha256")
    .update([orgId, externalNumber, agent, callTypeRaw, timeKey, String(duration ?? "")].join("|"))
    .digest("hex")
    .slice(0, 40)

  try {
    await prisma.callEvent.create({
      data: {
        organizationId: orgId,
        provider: "threecx",
        providerCallId: fingerprint,
        eventType: "ReportCall",
        eventHash: fingerprint,
        payload: body as never,
      },
    })
  } catch (err) {
    // P2002 on (organizationId, provider, providerCallId, eventHash) — already journaled.
    if (isUniqueViolation(err)) {
      return NextResponse.json({ ok: true, duplicate: true })
    }
    throw err
  }

  const phoneIdentity = threeCxPhoneVariants(externalNumber)
  const { contactId, leadId } = await matchCallParty(prisma, orgId, externalNumber)
  const targetPhoneE164 = phoneIdentity.canonicalE164 ?? null
  const endedAt = duration ? new Date(startedAt.getTime() + duration * 1000) : startedAt

  // A click-to-call from a contact card already wrote a CallLog (status
  // "initiated") when POST /api/v1/calls asked the PBX to dial. The template
  // knows nothing about it, so creating a row here would leave the agent with
  // TWO entries for one conversation: one stuck at "initiated" forever, one
  // completed. Close the open one instead — that is also the only way the
  // click-to-call row ever leaves "initiated", since the CRM template sends no
  // intermediate ringing/answered events.
  const openCall = await findOpenCallToClose(orgId, { direction, externalNumber, startedAt })

  const callLog = openCall
    ? await prisma.callLog.update({
        where: { id: openCall.id },
        data: {
          status,
          duration,
          endedAt,
          ...(targetPhoneE164 ? { targetPhoneE164 } : {}),
          wasAnswered: answered,
          providerOutcome: answered ? "connected" : "no_answer",
          // Keep the click-to-call's own providerCallId (the PBX call id from
          // makecall) — only fill it when the row never got one.
          providerCallId: openCall.providerCallId ?? fingerprint,
          contactId: openCall.contactId ?? contactId,
          leadId: openCall.leadId ?? leadId,
          notes: buildNotes({ callTypeRaw, agent, displayName }),
        },
      })
    : await prisma.callLog.create({
        data: {
          organizationId: orgId,
          channelConfigId: channelConfigId ?? undefined,
          callSid: fingerprint,
          providerCallId: fingerprint,
          direction,
          fromNumber: direction === "inbound" ? externalNumber : agent || "unknown",
          toNumber: direction === "inbound" ? agent || "unknown" : externalNumber,
          targetPhoneE164,
          status,
          duration,
          provider: "threecx",
          wasAnswered: answered,
          providerOutcome: answered ? "connected" : "no_answer",
          contactId,
          leadId,
          startedAt,
          endedAt,
          notes: buildNotes({ callTypeRaw, agent, displayName }),
        },
      })

  // A reused row may already carry an activity; a second one would double the
  // call in the contact's timeline.
  if (!callLog.activityId) {
    const activity = await prisma.activity.create({
      data: {
        organizationId: orgId,
        type: "call",
        subject: buildSubject({ direction, answered, externalNumber, displayName }),
        description: buildDescription({ callTypeRaw, agent, duration }),
        contactId: callLog.contactId ?? undefined,
        completedAt: new Date(),
      },
    })
    await prisma.callLog.update({ where: { id: callLog.id }, data: { activityId: activity.id } })
  }
  await prisma.callEvent.updateMany({
    where: { organizationId: orgId, provider: "threecx", providerCallId: fingerprint },
    data: { callLogId: callLog.id },
  })

  return NextResponse.json({ ok: true, callLogId: callLog.id })
}

function buildNotes(parts: {
  callTypeRaw: string
  agent: string
  displayName: string
}): string | undefined {
  const bits = [
    parts.callTypeRaw ? `3CX: ${parts.callTypeRaw}` : "",
    parts.agent ? `ext. ${parts.agent}` : "",
    parts.displayName ? `PBX name: ${parts.displayName}` : "",
  ].filter(Boolean)
  return bits.length ? bits.join(" · ") : undefined
}

function buildSubject(parts: {
  direction: "inbound" | "outbound"
  answered: boolean
  externalNumber: string
  displayName: string
}): string {
  const who = parts.displayName || parts.externalNumber
  if (parts.direction === "inbound") {
    return parts.answered ? `Inbound call — ${who}` : `Missed call — ${who}`
  }
  return parts.answered ? `Outbound call — ${who}` : `Outbound call, no answer — ${who}`
}

function buildDescription(parts: {
  callTypeRaw: string
  agent: string
  duration?: number
}): string {
  const bits: string[] = []
  if (parts.duration) {
    const mm = Math.floor(parts.duration / 60)
    const ss = (parts.duration % 60).toString().padStart(2, "0")
    bits.push(`Duration: ${mm}:${ss}`)
  }
  if (parts.agent) bits.push(`Extension: ${parts.agent}`)
  if (parts.callTypeRaw) bits.push(`Type: ${parts.callTypeRaw}`)
  return bits.join(" · ")
}

/** How far back a still-open call log may be to count as "this call". */
const OPEN_CALL_MATCH_WINDOW_MS = 2 * 60 * 60 * 1000

/**
 * The still-open CallLog this journaling POST is finishing, if any.
 *
 * Matched on direction + the external party's number + a bounded time window.
 * The window matters both ways: too short and a long conversation gets a
 * duplicate row, too long and yesterday's abandoned "initiated" row gets closed
 * by today's call. Two hours covers any real conversation.
 *
 * Terminal rows are excluded, so a completed call is never rewritten.
 */
async function findOpenCallToClose(
  orgId: string,
  params: { direction: "inbound" | "outbound"; externalNumber: string; startedAt: Date },
): Promise<{ id: string; providerCallId: string | null; contactId: string | null; leadId: string | null; activityId: string | null } | null> {
  const { exact } = threeCxPhoneVariants(params.externalNumber)
  if (exact.length === 0) return null

  // Outbound: the external party is the callee. Inbound: the caller.
  const numberField = params.direction === "outbound" ? "toNumber" : "fromNumber"
  const since = new Date(Date.now() - OPEN_CALL_MATCH_WINDOW_MS)

  const numberMatch = { [numberField]: { in: exact } } as Prisma.CallLogWhereInput

  return prisma.callLog.findFirst({
    where: {
      organizationId: orgId,
      provider: "threecx",
      direction: params.direction,
      status: { in: ["initiated", "ringing", "in-progress"] },
      startedAt: { gte: since },
      ...numberMatch,
    },
    select: { id: true, providerCallId: true, contactId: true, leadId: true, activityId: true },
    orderBy: { startedAt: "desc" },
  })
}

function isUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && (err as { code?: string }).code === "P2002")
}

// ── per-event pushes (Call Control relay / custom integrations) ─────────────

async function handleCallEvent(
  orgId: string,
  eventType: string,
  body: Record<string, unknown>,
): Promise<NextResponse> {
  const callData = (body.call || body.data || body) as Record<string, unknown>

  const callId = str(pick(callData, "callId", "id", "CallId"))
  const callerNumber = str(pick(callData, "callerNumber", "from", "CallerNumber"))
  const calleeNumber = str(pick(callData, "calleeNumber", "to", "CalleeNumber"))

  console.log(`[3CX Webhook] Event: ${eventType}, callId: ${callId}, org: ${orgId}`)

  switch (eventType) {
    case "call.ringing":
    case "Ringing": {
      const direction = callData.direction === "outbound" ? "outbound" : "inbound"
      const phoneToMatch = direction === "inbound" ? callerNumber : calleeNumber

      let contactId: string | undefined
      let leadId: string | undefined
      if (phoneToMatch) {
        const matched = await matchCallParty(prisma, orgId, phoneToMatch)
        contactId = matched.contactId
        leadId = matched.leadId
      }

      try {
        await prisma.callLog.create({
          data: {
            organizationId: orgId,
            callSid: callId || undefined,
            providerCallId: callId || undefined,
            direction,
            fromNumber: callerNumber,
            toNumber: calleeNumber,
            targetPhoneE164: normalizeManualLeadPhone(phoneToMatch)?.e164 ?? null,
            status: "ringing",
            provider: "threecx",
            contactId,
            leadId,
            startedAt: new Date(),
          },
        })
      } catch (err) {
        // Partial unique index on (organizationId, provider, providerCallId):
        // one call ringing several extensions (a ring group — how this PBX
        // routes its DID) repeats the event per leg. The first leg is logged,
        // the rest are the same call and are dropped.
        if (!isUniqueViolation(err)) throw err
        console.log(`[3CX Webhook] Duplicate ringing event for call ${callId}, org: ${orgId}`)
      }
      break
    }

    case "call.answered":
    case "Answered": {
      if (callId) {
        await prisma.callLog.updateMany({
          where: { organizationId: orgId, callSid: callId },
          data: { status: "in-progress", wasAnswered: true },
        })
      }
      break
    }

    case "call.ended":
    case "Ended":
    case "call.completed": {
      const duration = parseThreeCxDuration(pick(callData, "duration", "Duration"))
      const recordingUrl = str(pick(callData, "recordingUrl", "RecordingUrl")) || null

      if (callId) {
        const existing = await prisma.callLog.findFirst({
          where: { organizationId: orgId, callSid: callId },
        })

        await prisma.callLog.updateMany({
          where: { organizationId: orgId, callSid: callId },
          data: {
            status: "completed",
            // A generic Ended event alone does not prove answer. Only the
            // authenticated Answered event may promote this row into trusted
            // connected-history evidence.
            wasAnswered: existing?.wasAnswered === true,
            ...(existing?.wasAnswered === true
              ? { providerOutcome: "connected" }
              : {}),
            duration,
            recordingUrl,
            endedAt: new Date(),
          },
        })

        if (existing && !existing.activityId) {
          const activity = await prisma.activity.create({
            data: {
              organizationId: orgId,
              type: "call",
              subject: `${existing.direction === "inbound" ? "Inbound" : "Outbound"} call — ${existing.direction === "inbound" ? existing.fromNumber : existing.toNumber}`,
              description: duration
                ? `Duration: ${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, "0")}`
                : undefined,
              contactId: existing.contactId,
              companyId: existing.companyId,
              createdBy: existing.userId,
              completedAt: new Date(),
            },
          })
          await prisma.callLog.updateMany({
            where: { organizationId: orgId, callSid: callId },
            data: { activityId: activity.id },
          })
        }
      }
      break
    }

    case "call.missed":
    case "Missed": {
      if (callId) {
        await prisma.callLog.updateMany({
          where: { organizationId: orgId, callSid: callId },
          data: {
            status: "no-answer",
            wasAnswered: false,
            providerOutcome: "no_answer",
            endedAt: new Date(),
          },
        })
      }
      break
    }

    default:
      console.log(`[3CX Webhook] Unknown event: ${eventType}`)
  }

  return NextResponse.json({ ok: true })
}

// Health probe. KEEP THIS LAST: scripts/rls/find-context-gaps.py slices the file
// from one exported handler to the next, so an export placed above the helpers
// would swallow their prisma calls into its block and report a false RLS gap.
export async function GET() {
  return NextResponse.json({ status: "ok", service: "3cx-webhook" })
}
