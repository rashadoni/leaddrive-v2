import { createHash } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { isManagerOrAbove } from "@/lib/constants"
import { normalizeManualLeadPhone, type ManualLeadAiBlocker } from "@/lib/voice-agent/manual-lead-call"
import { dispatchManualLeadAiCall } from "@/lib/voice-agent/dispatch-manual-lead-call"
import type { DemoJourneyState } from "./journey"
import { PROMPT_SERVED_EVENT } from "./call-prompt"
import { DEMO_LEAD_SOURCE } from "./prospect-lead"
import { normalizeDemoPhone } from "./phone-verification"
import { inDemoSalesOrganization } from "./sales-org"

/**
 * The one real AI call a prospect asked for in the demo.
 *
 * It is placed through the same function as a manager's AI call from a lead
 * card (src/lib/voice-agent/dispatch-manual-lead-call.ts) — locks, policy,
 * calling hours, opt-outs, the lease, and the rule that an uncertain dispatch
 * is never redialled — rather than through a copy of any of it.
 *
 *  - Who calls: the admin who issued this grant with "live call" ticked. They
 *    allowed it, and they get the follow-up. They must still be an active
 *    manager-or-above in the sales organisation; otherwise nobody calls.
 *  - Whom: the prospect's lead in the sales organisation, on the phone the
 *    prospect proved with a code and agreed to. A demo-created lead takes
 *    that phone; a lead that already existed with a different phone is not
 *    rewritten, and the call is refused rather than placed to a number the
 *    prospect did not prove.
 *  - How often: once per grant, ever. The idempotency key is derived from the
 *    grant, so a repeated request replays the same call instead of dialling
 *    again.
 *  - What the prospect learns: a phase and, at the end, which of the
 *    journey's call outcomes happened. Never an id, a number or a transcript.
 *  - Only once the agent can speak as LeadDrive. The line's own prompt
 *    belongs to another business's calls; a demo call gets the demo script
 *    only when the PBX asks for each call's prompt. Until the CRM has seen the
 *    PBX do that, no demo call is placed at all.
 */

export type DemoCallPhase = "none" | "queued" | "calling" | "ended"

export interface DemoCallStatus {
  phase: DemoCallPhase
  /** Set once the call has ended: the journey state that records it. */
  outcome: DemoJourneyState | null
}

export type RequestDemoCallResult =
  | { ok: true; status: DemoCallStatus }
  | { ok: false; code: "not_enabled" | "agent_not_ready" | "phone_not_verified" | "lead_not_ready" | "no_caller" | "phone_mismatch" | "unconfigured" }
  | { ok: false; code: "blocked"; reason: ManualLeadAiBlocker | "paused" | "error"; retryable: boolean }

type Grant = { id: string; status: string; liveCallEnabled: boolean; createdBy: string; requestId: string }

/** Refusals the prospect can wait out; everything else ends the attempt. */
const RETRYABLE_BLOCKERS: ReadonlySet<string> = new Set([
  "outside_calling_hours",
  "active_call_exists",
  "provider_unavailable",
  "user_limit_reached",
  "organization_limit_reached",
  "paused",
])

/** One call per grant, forever: a retry replays, it never redials. */
export function demoCallIdempotencyKey(grantId: string): string {
  const hex = createHash("sha256").update(`demo-live-call:${grantId}`).digest("hex")
  const variant = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/** How recent the evidence must be that the PBX asks for each call's prompt. */
export const PER_CALL_PROMPT_EVIDENCE_DAYS = 30

/**
 * Whether the voice agent can speak as LeadDrive on a demo call: the PBX has
 * recently asked the CRM for a specific call's prompt (runtime-config records
 * that once per call). Without it the agent would use the line's prompt.
 */
export async function demoCallAgentReady(now: Date = new Date()): Promise<boolean> {
  const since = new Date(now.getTime() - PER_CALL_PROMPT_EVIDENCE_DAYS * 24 * 60 * 60_000)
  const entered = await inDemoSalesOrganization(async (organizationId) => {
    const seen = await prisma.callEvent.findFirst({
      where: { organizationId, eventType: PROMPT_SERVED_EVENT, receivedAt: { gte: since } },
      select: { id: true },
    })
    return Boolean(seen)
  })
  return entered?.value ?? false
}

function callableGrant(grant: Grant): boolean {
  return grant.status === "ACTIVE" && grant.liveCallEnabled
}

/**
 * Which journey outcome a finished call session stands for. Only what the
 * session actually says: an ending nobody reported is "attention required",
 * never a guess at an answered call.
 */
export function demoCallOutcome(session: { status: string; outcome: string | null }): DemoJourneyState | null {
  switch (session.status) {
    case "prepared":
    case "dispatching":
      return null
    case "completed":
      switch (session.outcome) {
        case "connected":
          return "CALL_RESULT_RECORDED"
        case "no_answer":
          return "CALL_NO_ANSWER"
        case "busy":
          return "CALL_BUSY"
        case "failed":
        case "cancelled":
          return "CALL_FAILED"
        default:
          return "CALL_ATTENTION_REQUIRED"
      }
    case "no_answer":
      return "CALL_NO_ANSWER"
    case "busy":
      return "CALL_BUSY"
    case "failed":
    case "cancelled":
      return "CALL_FAILED"
    case "blocked":
      return "CALL_BLOCKED"
    default:
      return "CALL_ATTENTION_REQUIRED"
  }
}

export async function demoCallStatus(grant: Pick<Grant, "id">): Promise<DemoCallStatus> {
  const entered = await inDemoSalesOrganization(async (organizationId) => {
    const session = await prisma.voiceCallSession.findUnique({
      where: { organizationId_idempotencyKey: { organizationId, idempotencyKey: demoCallIdempotencyKey(grant.id) } },
      select: { status: true, outcome: true, callLog: { select: { status: true } } },
    })
    if (!session) return { phase: "none" as const, outcome: null }
    const outcome = demoCallOutcome(session)
    if (outcome) return { phase: "ended" as const, outcome }
    // Accepted by the provider: the phone is ringing or the call is on.
    const onTheLine = ["initiated", "ringing", "in-progress"].includes(session.callLog?.status ?? "")
    return { phase: onTheLine ? "calling" as const : "queued" as const, outcome: null }
  })
  return entered?.value ?? { phase: "none", outcome: null }
}

export async function requestDemoCall(params: { grant: Grant }): Promise<RequestDemoCallResult> {
  const { grant } = params
  if (!callableGrant(grant)) return { ok: false, code: "not_enabled" }
  if (!(await demoCallAgentReady())) return { ok: false, code: "agent_not_ready" }

  const verification = await runWithRlsBypass(() =>
    prisma.demoPhoneVerification.findFirst({
      where: { grantId: grant.id, verifiedAt: { not: null }, consentAt: { not: null } },
      select: { phoneE164: true, verifiedAt: true, consentVersion: true },
    }),
  )
  if (!verification) return { ok: false, code: "phone_not_verified" }

  const request = await runWithRlsBypass(() =>
    prisma.demoRequest.findUnique({
      where: { id: grant.requestId },
      select: { internalLeadId: true, internalLeadOrganizationId: true, leadLinkStatus: true, phone: true },
    }),
  )
  if (request?.leadLinkStatus !== "LINKED" || !request.internalLeadId) return { ok: false, code: "lead_not_ready" }
  // Only the phone on the prospect's own request is ever called; a
  // verification of any other number (none can be made now, but rows made
  // before that rule, or a request edited since, can exist) is not enough.
  if (normalizeDemoPhone(request.phone ?? "")?.e164 !== verification.phoneE164) return { ok: false, code: "phone_mismatch" }
  const leadId = request.internalLeadId

  const entered = await inDemoSalesOrganization(async (organizationId) => {
    // The voice agent serves exactly one organisation; a call from any other
    // would reach a runtime that does not know it.
    if (organizationId !== process.env.VOICE_AGENT_ORGANIZATION_ID?.trim()) return { kind: "refused" as const, code: "unconfigured" as const }
    if (organizationId !== request.internalLeadOrganizationId) return { kind: "refused" as const, code: "lead_not_ready" as const }

    const caller = await prisma.user.findFirst({
      where: { id: grant.createdBy, organizationId, isActive: true },
      select: { id: true, role: true },
    })
    if (!caller || !isManagerOrAbove(caller.role)) return { kind: "refused" as const, code: "no_caller" as const }

    const lead = await prisma.lead.findFirst({
      where: { id: leadId, organizationId },
      select: { id: true, phone: true, source: true },
    })
    if (!lead) return { kind: "refused" as const, code: "lead_not_ready" as const }
    const leadPhone = normalizeManualLeadPhone(lead.phone)?.e164 ?? null
    if (leadPhone !== verification.phoneE164) {
      if (leadPhone && lead.source !== DEMO_LEAD_SOURCE) return { kind: "refused" as const, code: "phone_mismatch" as const }
      await prisma.lead.updateMany({ where: { id: lead.id, organizationId }, data: { phone: verification.phoneE164 } })
    }

    const dispatched = await dispatchManualLeadAiCall({
      auth: { orgId: organizationId, userId: caller.id, role: caller.role },
      leadId: lead.id,
      idempotencyKey: demoCallIdempotencyKey(grant.id),
      consentAuditExtra: {
        via: "demo_center",
        demoGrantId: grant.id,
        consentVersion: verification.consentVersion,
        phoneVerifiedAt: verification.verifiedAt?.toISOString() ?? null,
      },
    })
    return { kind: "dispatched" as const, dispatched }
  })
  if (!entered) return { ok: false, code: "unconfigured" }
  if (entered.value.kind === "refused") return { ok: false, code: entered.value.code }

  const { dispatched } = entered.value
  switch (dispatched.kind) {
    case "dispatched":
    case "replay":
      return { ok: true, status: await demoCallStatus(grant) }
    case "blocked": {
      const reason = dispatched.blockers[0] ?? "provider_unavailable"
      return { ok: false, code: "blocked", reason, retryable: RETRYABLE_BLOCKERS.has(reason) }
    }
    case "paused":
      return { ok: false, code: "blocked", reason: "paused", retryable: true }
    case "not_found":
      return { ok: false, code: "lead_not_ready" }
    case "error":
      return { ok: false, code: "blocked", reason: "error", retryable: false }
  }
}
