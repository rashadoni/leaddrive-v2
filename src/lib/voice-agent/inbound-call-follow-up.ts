import { logAudit, prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"

import { scoreLeadNow } from "@/lib/ai/lead-scoring"
import { matchCallParty } from "@/lib/calls/party-match"
import { qualificationDueDate } from "@/lib/inbox/lead-qualification"
import { applyLeadAssignmentRules } from "@/lib/lead-assignment"
import { createNotification } from "@/lib/notifications"
import { resolveSalesBoardSlot } from "@/lib/tasks/sales-board"
import {
  customerReallySpoke,
  matchRequestedEmployee,
  readCallOutcome,
  type CallOutcome,
  type RequestedEmployee,
} from "@/lib/voice-agent/call-outcome"
import { isLineOrDemoCall } from "@/lib/voice-agent/line-or-demo-call"
import { aiCallLeadsEnabled } from "@/lib/voip/inbound-answer"
import { loadInboundAnswerSelection } from "@/lib/voip/inbound-answer-config"
import { threeCxPhoneVariants } from "@/lib/voip/threecx-crm"

/**
 * After the AI has talked to somebody who called us: the person becomes a lead
 * and, when they need a human, somebody gets a task (owner, 2026-11-21).
 *
 * Runs only behind the switch on the VoIP page, which is off by default.
 *
 * Idempotent on the call, because the station retries and an analysis can be
 * re-run: the lead and the task have ids derived from the call, the call row is
 * locked while its lead is decided, and two simultaneous calls from one new
 * number queue on a lock of that number, so they land on one lead.
 *
 * What it deliberately does not do on a new lead: start workflows, webhooks or
 * anything else that writes to the customer. Same as the leads the inbox AI
 * creates: nobody decided that a machine's guess at night may do that.
 */

export const AI_CALL_LEAD_SOURCE = "inbound_call"
export const FOLLOW_UP_CALL_FIELD = "aiCallFollowUpCallId"

export function callLeadId(callId: string): string {
  return `call_lead_${callId}`
}

export function callFollowUpTaskId(callId: string): string {
  return `call_followup_${callId}`
}

/**
 * Who the caller meant, among the people who could take the call. Never throws:
 * a failed read must not cost the call its analysis.
 */
export async function resolveRequestedEmployee(
  organizationId: string,
  spokenName: string | null | undefined,
): Promise<RequestedEmployee | null> {
  const name = spokenName?.trim()
  if (!name) return null
  try {
    const people = await prisma.user.findMany({
      where: { organizationId, isActive: true, role: { not: "reviewer" } },
      select: { id: true, name: true },
    })
    return matchRequestedEmployee(name, people)
  } catch {
    return { spokenName: name.slice(0, 120), userId: null, match: "not_found" }
  }
}

export type InboundCallFollowUpResult =
  | {
      status: "skipped"
      reason: "not-found" | "not-ai" | "excluded" | "disabled" | "no-real-conversation"
    }
  | {
      status: "done"
      leadId: string | null
      contactId: string | null
      leadCreated: boolean
      taskId: string | null
      taskAssigneeId: string | null
    }
  | { status: "failed" }

async function switchIsOn(organizationId: string, channelConfigId: string | null): Promise<boolean> {
  const configId = channelConfigId ?? (await loadInboundAnswerSelection(organizationId)).channelConfigId
  if (!configId) return false
  const config = await prisma.channelConfig.findFirst({
    where: { id: configId, organizationId, channelType: "voip" },
    select: { settings: true },
  })
  return aiCallLeadsEnabled(config?.settings)
}

const OUTCOME_WORDS: Record<CallOutcome, string> = {
  qualified: "uyğundur",
  not_qualified: "uyğun deyil",
  needs_human: "insan lazımdır",
}

type CallParty = { leadId: string | null; contactId: string | null; leadCreated: boolean }

async function attachCallToParty(input: {
  organizationId: string
  callLogId: string
  phone: string
  name: string
  summary: string
  interest: string
  outcome: CallOutcome | null
}): Promise<CallParty | null> {
  const { organizationId, callLogId, phone } = input
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // Order matters: the number first, then the call. Two calls from one new
    // number must not both see "nobody has this number" and each create a lead.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ai-call-lead:${organizationId}:${phone}`}, 0))`
    const [call] = await tx.$queryRaw<Array<{ leadId: string | null; contactId: string | null }>>`
      SELECT "leadId", "contactId"
      FROM "call_logs"
      WHERE "organizationId" = ${organizationId} AND "id" = ${callLogId}
      FOR UPDATE
    `
    if (!call) return null
    if (call.leadId || call.contactId) {
      return { leadId: call.leadId, contactId: call.contactId, leadCreated: false }
    }

    // Matched again rather than trusted from ringing: the number may have
    // become somebody's card while the conversation was going on.
    const party = await matchCallParty(tx, organizationId, phone)
    if (party.contactId || party.leadId) {
      await tx.callLog.updateMany({
        where: { id: callLogId, organizationId },
        data: { contactId: party.contactId ?? null, leadId: party.leadId ?? null },
      })
      return { leadId: party.leadId ?? null, contactId: party.contactId ?? null, leadCreated: false }
    }

    const lead = await tx.lead.create({
      data: {
        id: callLeadId(callLogId),
        organizationId,
        contactName: input.name.slice(0, 200),
        phone,
        source: AI_CALL_LEAD_SOURCE,
        sourceDetail: "AI voice agent",
        interest: input.interest.slice(0, 500),
        // A wrong number stays on record but is nobody's open work.
        status: input.outcome === "not_qualified" ? "lost" : "new",
        priority: input.outcome === "needs_human" ? "high" : "medium",
        notes: [
          ...(input.outcome ? [`AI zəng nəticəsi: ${OUTCOME_WORDS[input.outcome]}`] : []),
          `Xülasə: ${input.summary}`,
          `Telefon: ${phone}`,
          `Zəng ID: ${callLogId}`,
        ].join("\n"),
      },
      select: { id: true },
    })
    await tx.callLog.updateMany({
      where: { id: callLogId, organizationId },
      data: { leadId: lead.id },
    })
    return { leadId: lead.id, contactId: null, leadCreated: true }
  })
}

/** The lead's owner, then whoever took the call, then the organization's first administrator. */
async function responsibleUserId(
  organizationId: string,
  preferred: Array<string | null | undefined>,
): Promise<string | null> {
  const wanted = preferred.filter((id): id is string => Boolean(id))
  if (wanted.length > 0) {
    const active = await prisma.user.findMany({
      where: { organizationId, id: { in: wanted }, isActive: true, role: { not: "reviewer" } },
      select: { id: true },
    })
    const ids = new Set(active.map((user: { id: string }) => user.id))
    const first = wanted.find((id) => ids.has(id))
    if (first) return first
  }
  const fallback = await prisma.user.findFirst({
    where: { organizationId, isActive: true, role: { in: ["admin", "manager"] } },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  })
  return fallback?.id ?? null
}

async function fileFollowUpTask(input: {
  organizationId: string
  callLogId: string
  assigneeId: string
  personal: boolean
  name: string
  summary: string
  phone: string | null
  requested: RequestedEmployee | null
  relatedType: "lead" | "contact" | "call"
  relatedId: string
  pipelineId: string | null
  now: Date
}): Promise<string | null> {
  const { organizationId, callLogId } = input
  const taskId = callFollowUpTaskId(callLogId)
  const organization = await prisma.organization.findFirst({
    where: { id: organizationId },
    select: { features: true, settings: true },
  })
  const settings = organization?.settings && typeof organization.settings === "object" && !Array.isArray(organization.settings)
    ? organization.settings as Record<string, unknown>
    : {}
  const timeZone = typeof settings.timezone === "string" ? settings.timezone : "Asia/Baku"
  const board = await resolveSalesBoardSlot(organizationId, {
    features: organization?.features,
    pipelineId: input.pipelineId,
  }).catch(() => null)
  const title = (input.personal
    ? `Müştəri sizi soruşub — ${input.name}`
    : `Müştəri əməkdaşla danışmaq istəyir — ${input.name}`).slice(0, 200)
  const requestedLine = input.requested && !input.personal
    ? [`Müştərinin istədiyi işçi: ${input.requested.spokenName} (${
        input.requested.match === "ambiguous" ? "bir neçə işçi uyğun gəlir" : "belə işçi tapılmadı"
      })`]
    : []

  const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // A task somebody deleted stays deleted: naming the non-null predicate is
    // the soft-delete extension's way of letting this read see it.
    const live = await tx.task.findFirst({ where: { id: taskId, organizationId, deletedAt: null }, select: { id: true } })
    const deleted = await tx.task.findFirst({ where: { id: taskId, organizationId, deletedAt: { not: null } }, select: { id: true } })
    if (live || deleted) return false
    await tx.task.create({
      data: {
        id: taskId,
        organizationId,
        ...(board
          ? { divisionId: board.divisionId, boardColumnKey: board.columnKey, boardPosition: board.position }
          : {}),
        title,
        description: [
          ...requestedLine,
          ...(input.phone ? [`Telefon: ${input.phone}`] : []),
          `Xülasə: ${input.summary}`,
        ].join("\n"),
        priority: "high",
        dueDate: qualificationDueDate(input.now, timeZone),
        assignedTo: input.assigneeId,
        relatedType: input.relatedType,
        relatedId: input.relatedId,
        customFields: { [FOLLOW_UP_CALL_FIELD]: callLogId } as Prisma.InputJsonValue,
      },
      select: { id: true },
    })
    return true
  }).catch((error: unknown) => {
    // Two workers racing on the same call: the other one filed it.
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "P2002") return false
    throw error
  })
  if (!created) return null

  logAudit(organizationId, "create", "task", taskId, title, { newValue: { source: "ai-call-follow-up" } })
  await createNotification({
    organizationId,
    userId: input.assigneeId,
    type: "warning",
    title: input.personal ? "Müştəri sizi soruşub" : "Zəngdən sonra insan lazımdır",
    message: title,
    entityType: "task",
    entityId: taskId,
    kind: "task.created",
    push: true,
  }).catch(() => {})
  return taskId
}

/**
 * Must run inside the call's tenant scope. Never throws: this is the tail of an
 * analysis the rest of the product depends on.
 */
export async function recordInboundCallFollowUp(input: {
  organizationId: string
  callLogId: string
  turns: ReadonlyArray<{ role: "customer" | "agent"; text: string }>
  now?: Date
}): Promise<InboundCallFollowUpResult> {
  const { organizationId, callLogId } = input
  try {
    const call = await prisma.callLog.findFirst({
      where: { id: callLogId, organizationId, direction: "inbound" },
      select: {
        callMode: true,
        handoffState: true,
        conversationOutcome: true,
        consentAudit: true,
        channelConfigId: true,
        fromNumber: true,
        insights: true,
        userId: true,
        leadId: true,
        contactId: true,
      },
    })
    if (!call) return { status: "skipped", reason: "not-found" }
    if (isLineOrDemoCall(call.consentAudit)) return { status: "skipped", reason: "excluded" }
    if (call.callMode !== "ai" && call.handoffState === null) return { status: "skipped", reason: "not-ai" }
    if (!(await switchIsOn(organizationId, call.channelConfigId))) return { status: "skipped", reason: "disabled" }
    if (call.conversationOutcome !== "customer_spoke" || !customerReallySpoke(input.turns)) {
      return { status: "skipped", reason: "no-real-conversation" }
    }

    const now = input.now ?? new Date()
    const stored = readCallOutcome(call.insights)
    const insight = call.insights && typeof call.insights === "object" && !Array.isArray(call.insights)
      ? call.insights as { summary?: unknown; topics?: unknown }
      : {}
    const summary = typeof insight.summary === "string" ? insight.summary : ""
    const topic = Array.isArray(insight.topics) && typeof insight.topics[0] === "string" ? insight.topics[0] : ""
    // A withheld or unreadable number has nobody to call back: no lead, though
    // a person who was asked for by name should still hear about it.
    const phone = threeCxPhoneVariants(call.fromNumber).canonicalE164 ?? null
    const displayName = stored.callerName ?? phone ?? call.fromNumber

    const party: CallParty | null = phone
      ? await attachCallToParty({
          organizationId,
          callLogId,
          phone,
          name: displayName,
          summary,
          interest: topic || summary,
          outcome: stored.outcome,
        })
      : { leadId: call.leadId, contactId: call.contactId, leadCreated: false }
    if (!party) return { status: "skipped", reason: "not-found" }

    if (party.leadCreated && party.leadId) {
      // After the commit: the scorer and the rules read through their own connection.
      await scoreLeadNow(organizationId, party.leadId)
      logAudit(organizationId, "create", "lead", party.leadId, displayName, { newValue: { source: "ai-call" } })
      if (stored.outcome !== "not_qualified") {
        await applyLeadAssignmentRules(organizationId, {
          id: party.leadId,
          source: AI_CALL_LEAD_SOURCE,
          phone,
          contactName: displayName,
        })
      }
    }

    const lead = party.leadId
      ? await prisma.lead.findFirst({
          where: { id: party.leadId, organizationId },
          select: { assignedTo: true, status: true, contactName: true, pipelineId: true },
        })
      : null
    if (party.leadCreated && party.leadId && lead?.assignedTo && stored.outcome !== "not_qualified") {
      await createNotification({
        organizationId,
        userId: lead.assignedTo,
        type: "info",
        title: "Yeni lid təyin edildi",
        message: `${displayName}: ${summary}`.slice(0, 300),
        entityType: "lead",
        entityId: party.leadId,
        kind: "lead.created",
        push: true,
      }).catch(() => {})
    }

    const requested = stored.requestedEmployee
    // A customer coming back to a lead somebody closed is news, even if the AI
    // finds them a good fit and nobody was named: a closed lead has no one
    // watching it, and reopening it is a person's decision.
    const closedLeadCameBack = !party.leadCreated
      && stored.outcome === "qualified"
      && (lead?.status === "lost" || lead?.status === "converted")
    if (!requested && stored.outcome !== "needs_human" && !closedLeadCameBack) {
      return {
        status: "done",
        leadId: party.leadId,
        contactId: party.contactId,
        leadCreated: party.leadCreated,
        taskId: null,
        taskAssigneeId: null,
      }
    }

    let assigneeId: string | null = null
    let personal = false
    if (requested?.match === "matched" && requested.userId) {
      const person = await prisma.user.findFirst({
        where: { id: requested.userId, organizationId, isActive: true, role: { not: "reviewer" } },
        select: { id: true },
      })
      if (person) {
        assigneeId = person.id
        personal = true
      }
    }
    assigneeId ??= await responsibleUserId(organizationId, [lead?.assignedTo, call.userId])
    const relatedId = party.leadId ?? party.contactId ?? callLogId
    const relatedType = party.leadId ? "lead" as const : party.contactId ? "contact" as const : "call" as const
    const taskId = assigneeId
      ? await fileFollowUpTask({
          organizationId,
          callLogId,
          assigneeId,
          personal,
          name: stored.callerName ?? lead?.contactName ?? displayName,
          summary,
          phone,
          requested,
          relatedType,
          relatedId,
          pipelineId: lead?.pipelineId ?? null,
          now,
        })
      : null
    return {
      status: "done",
      leadId: party.leadId,
      contactId: party.contactId,
      leadCreated: party.leadCreated,
      taskId,
      taskAssigneeId: taskId ? assigneeId : null,
    }
  } catch (error) {
    console.error("[voice-agent] inbound call follow-up failed", {
      callLogId,
      error: error instanceof Error ? error.name : "unknown",
    })
    return { status: "failed" }
  }
}
