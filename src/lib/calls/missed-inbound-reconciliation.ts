import type { Prisma } from "@prisma/client"

export const MISSED_INBOUND_TASK_FIELD = "missedInboundCallId"
export const MISSED_INBOUND_SOURCE_FIELD = "missedInboundSource"
export const MISSED_INBOUND_RECONCILED_EVENT_TYPE = "asterisk_missed_inbound_reconciled"

const ASTERISK_LIFECYCLE_EVENT_TYPE = "asterisk_human_call_lifecycle"
const ASTERISK_LIFECYCLE_EVENT_HASH_PREFIX = "asterisk-human-lifecycle-v1:"
const RECONCILED_EVENT_HASH_PREFIX = "asterisk-missed-inbound-reconciled-v1:"
const DEFAULT_BATCH_SIZE = 100

type MissedInboundCandidate = {
  id: string
  organizationId: string
  providerCallId: string
  leadId: string | null
  contactId: string | null
  endedAt: Date
}

type ReconciliationClient = Pick<Prisma.TransactionClient, "callLog"> & {
  $transaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T>
}

type TaskIdentity = {
  id: string
  organizationId: string
  customFields: Prisma.JsonValue | null
}

type CandidateResult = "reconciled" | "already-reconciled"

export function missedInboundTaskId(callLogId: string): string {
  return `call_missed_inbound_${callLogId}`
}

function reconciledEventHash(callLogId: string): string {
  return `${RECONCILED_EVENT_HASH_PREFIX}${callLogId}`
}

function jsonObject(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, Prisma.JsonValue>
}

function taskIdentityMatches(task: TaskIdentity, call: MissedInboundCandidate): boolean {
  const fields = jsonObject(task.customFields)
  return task.id === missedInboundTaskId(call.id)
    && task.organizationId === call.organizationId
    && fields?.[MISSED_INBOUND_TASK_FIELD] === call.id
    && fields?.[MISSED_INBOUND_SOURCE_FIELD] === "asterisk"
}

function safeRelation(call: MissedInboundCandidate): {
  relatedType: "lead" | "contact" | "call"
  relatedId: string
} {
  if (call.leadId) return { relatedType: "lead", relatedId: call.leadId }
  if (call.contactId) return { relatedType: "contact", relatedId: call.contactId }
  return { relatedType: "call", relatedId: call.id }
}

function lifecycleProofWhere(): Prisma.CallEventWhereInput {
  return {
    provider: "asterisk",
    eventType: ASTERISK_LIFECYCLE_EVENT_TYPE,
    eventHash: { startsWith: ASTERISK_LIFECYCLE_EVENT_HASH_PREFIX },
    payload: { path: ["state"], equals: "no_answer" },
  }
}

export function missedInboundCallEvidenceWhere(): Prisma.CallLogWhereInput {
  return {
    provider: "asterisk",
    direction: "inbound",
    callMode: "human",
    status: "no-answer",
    providerOutcome: "no_answer",
    wasAnswered: false,
    endedAt: { not: null },
    providerCallId: { not: null },
    callEvents: {
      some: lifecycleProofWhere(),
    },
  }
}

async function reconcileCandidate(
  client: ReconciliationClient,
  candidate: MissedInboundCandidate,
): Promise<CandidateResult> {
  return client.$transaction(async (tx) => {
    const eventHash = reconciledEventHash(candidate.id)
    const fresh = await tx.callLog.findFirst({
      where: {
        id: candidate.id,
        organizationId: candidate.organizationId,
        ...missedInboundCallEvidenceWhere(),
        endedAt: candidate.endedAt,
        providerCallId: candidate.providerCallId,
        callEvents: {
          some: lifecycleProofWhere(),
          none: {
            provider: "asterisk",
            eventType: MISSED_INBOUND_RECONCILED_EVENT_TYPE,
            eventHash,
          },
        },
      },
      select: {
        id: true,
        organizationId: true,
        providerCallId: true,
        leadId: true,
        contactId: true,
        endedAt: true,
      },
    }) as MissedInboundCandidate | null

    // The lifecycle can be corrected while this bounded batch is waiting. A
    // corrected call is no longer work; a concurrently committed marker is
    // already work. Neither case may create a task from the stale scan row.
    if (!fresh) return "already-reconciled"

    // This append-only event is the cross-worker linearization point. It is
    // deliberately inserted before Task creation in the SAME transaction. Any
    // task error below throws out of this callback, so Prisma rolls the marker
    // back and a later tick can retry instead of losing the missed call.
    const marker = await tx.callEvent.createMany({
      data: {
        organizationId: fresh.organizationId,
        callLogId: fresh.id,
        provider: "asterisk",
        providerCallId: fresh.providerCallId,
        eventType: MISSED_INBOUND_RECONCILED_EVENT_TYPE,
        eventHash,
        payload: { version: 1, state: "task_recorded" },
      },
      skipDuplicates: true,
    })
    if (marker.count === 0) return "already-reconciled"
    if (marker.count !== 1) throw new Error("missed_inbound_marker_count_invalid")

    const relation = safeRelation(fresh)
    const taskId = missedInboundTaskId(fresh.id)
    await tx.task.createMany({
      data: {
        id: taskId,
        organizationId: fresh.organizationId,
        title: "Buraxılmış daxil olan zəngi yoxlayın",
        description: "Müştəri ilə geri əlaqə ehtiyacını yoxlayın.",
        status: "pending",
        priority: "high",
        dueDate: fresh.endedAt,
        assignedTo: null,
        ...relation,
        customFields: {
          [MISSED_INBOUND_TASK_FIELD]: fresh.id,
          [MISSED_INBOUND_SOURCE_FIELD]: "asterisk",
        },
      },
      skipDuplicates: true,
    })

    // A deterministic task may already be completed or soft-deleted. Those
    // rows are durable tombstones and must remain byte-for-byte unchanged. The
    // global Prisma extension hides deleted tasks unless `deletedAt` is named
    // at the top level, hence the two explicit reads.
    const active = await tx.task.findMany({
      where: {
        id: taskId,
        organizationId: fresh.organizationId,
        deletedAt: null,
      },
      select: {
        id: true,
        organizationId: true,
        customFields: true,
      },
      take: 1,
    })
    let durable = active[0] as TaskIdentity | undefined
    if (!durable) {
      const deleted = await tx.task.findMany({
        where: {
          id: taskId,
          organizationId: fresh.organizationId,
          deletedAt: { not: null },
        },
        select: {
          id: true,
          organizationId: true,
          customFields: true,
        },
        take: 1,
      })
      durable = deleted[0] as TaskIdentity | undefined
    }
    if (!durable || !taskIdentityMatches(durable, fresh)) {
      throw new Error("missed_inbound_task_identity_conflict")
    }

    return "reconciled"
  })
}

export async function reconcileMissedInboundCalls(client: ReconciliationClient) {
  const selectedRows = await client.callLog.findMany({
    where: {
      ...missedInboundCallEvidenceWhere(),
      callEvents: {
        some: lifecycleProofWhere(),
        none: {
          provider: "asterisk",
          eventType: MISSED_INBOUND_RECONCILED_EVENT_TYPE,
        },
      },
    },
    select: {
      id: true,
      organizationId: true,
      providerCallId: true,
      leadId: true,
      contactId: true,
      endedAt: true,
    },
    orderBy: [{ endedAt: "asc" }, { id: "asc" }],
    take: DEFAULT_BATCH_SIZE,
  })

  // Prisma keeps these two selected fields nullable at the type level even
  // though the query requires both to be non-null. Keep a defensive runtime
  // fence so an unexpected row cannot create a malformed event or task.
  const candidates: MissedInboundCandidate[] = selectedRows.flatMap((row) => {
    if (!row.providerCallId || !row.endedAt) return []
    return [{ ...row, providerCallId: row.providerCallId, endedAt: row.endedAt }]
  })

  let reconciled = 0
  let alreadyReconciled = 0
  let failed = selectedRows.length - candidates.length

  // Each candidate owns its own transaction. One poison row must not sit at
  // the head of the bounded oldest-first batch and starve every later call.
  for (const candidate of candidates) {
    try {
      const result = await reconcileCandidate(client, candidate)
      if (result === "reconciled") reconciled += 1
      else alreadyReconciled += 1
    } catch (error) {
      failed += 1
      console.error(
        "[missed-inbound-reconciliation] candidate transaction failed",
        error instanceof Error ? error.message : "unknown_error",
      )
    }
  }

  return {
    selected: selectedRows.length,
    reconciled,
    alreadyReconciled,
    failed,
  }
}
