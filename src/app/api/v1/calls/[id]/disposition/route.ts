import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { isManagerOrAbove } from "@/lib/constants"
import { withRlsAuth } from "@/lib/with-rls"
import {
  COMMITMENT_CALL_FIELD,
  callbackReminderId,
} from "@/lib/commitments/call-commitment-identity"
import {
  CALL_DISPOSITIONS,
  isCallDisposition,
} from "@/lib/calls/disposition"

const nonCallbackDispositionSchema = z.enum(CALL_DISPOSITIONS).exclude(["callback"])

const dispositionBodySchema = z.discriminatedUnion("disposition", [
  z.object({
    disposition: z.literal("callback"),
    // A browser `datetime-local` has no offset. The client must turn that local
    // promise into ISO first, so the server stores one unambiguous instant.
    callbackAt: z.string().datetime({ offset: true }),
  }).strict(),
  z.object({
    disposition: nonCallbackDispositionSchema,
  }).strict(),
])

/**
 * PATCH /api/v1/calls/[id]/disposition — set call disposition after call ends
 */
export const PATCH = withRlsAuth("voip", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {

  const orgId = auth.orgId
  const { id } = await params
  const rawBody = await req.json().catch(() => null)
  const rawDisposition = rawBody && typeof rawBody === "object"
    ? (rawBody as { disposition?: unknown }).disposition
    : null
  if (!isCallDisposition(rawDisposition)) {
    return NextResponse.json({ error: "Invalid disposition" }, { status: 400 })
  }
  const parsed = dispositionBodySchema.safeParse(rawBody)
  if (!parsed.success) {
    const callbackMissingTime = rawBody
      && typeof rawBody === "object"
      && (rawBody as { disposition?: unknown }).disposition === "callback"
      && !("callbackAt" in rawBody)
    return NextResponse.json({
      error: callbackMissingTime ? "callback_time_required" : "invalid_disposition_payload",
    }, { status: 400 })
  }

  const callbackAt = parsed.data.disposition === "callback"
    ? new Date(parsed.data.callbackAt)
    : null
  if (callbackAt && callbackAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: "callback_time_must_be_future" }, { status: 400 })
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.callLog.updateMany({
        where: {
          id,
          organizationId: orgId,
          // AI analysis is the only writer for AI call outcomes. Letting this
          // human endpoint race it can leave a callback task behind even when
          // the analysis later replaces the disposition.
          callMode: "human",
          // Reading team call history is broader than mutating a promise made
          // by one seller. Managers may correct team outcomes; everyone else
          // can only label the call they personally placed.
          ...(isManagerOrAbove(auth.role) ? {} : { userId: auth.userId }),
        },
        data: { disposition: parsed.data.disposition },
      })
      if (updated.count === 0) return { found: false }

      const activityId = callbackReminderId(id)
      if (callbackAt) {
        // Read only after the conditional update succeeded. If any later write
        // fails, the transaction rolls the disposition back too: the product
        // must never say "callback" while losing the promised time.
        const call = await tx.callLog.findFirst({
          where: { id, organizationId: orgId },
          select: {
            id: true,
            leadId: true,
            contactId: true,
            companyId: true,
            dealId: true,
            ticketId: true,
            conversationId: true,
            userId: true,
          },
        })
        if (!call) throw new Error("updated_call_missing")

        const relatedType = call.leadId
          ? "lead"
          : call.dealId
            ? "deal"
            : call.ticketId
              ? "ticket"
              : call.conversationId
                ? "conversation"
                : null
        const relatedId = call.leadId
          ?? call.dealId
          ?? call.ticketId
          ?? call.conversationId
          ?? null
        const reminderOwnerId = call.userId ?? auth.userId
        await tx.activity.upsert({
          where: { id: activityId },
          create: {
            id: activityId,
            organizationId: orgId,
            type: "task",
            subject: "Callback",
            contactId: call.contactId,
            companyId: call.companyId,
            relatedType,
            relatedId,
            createdBy: call.userId ?? auth.userId,
            scheduledAt: callbackAt,
          },
          update: {
            subject: "Callback",
            contactId: call.contactId,
            companyId: call.companyId,
            relatedType,
            relatedId,
            scheduledAt: callbackAt,
            completedAt: null,
          },
        })
        // Activity is the lead timeline; Task is the durable work queue scanned
        // by commitment escalation. Keeping both writes in this transaction is
        // what prevents a visible "callback" outcome from losing its reminder.
        await scheduleCallbackReminder(tx, {
          organizationId: orgId,
          callId: id,
          dueDate: callbackAt,
          ownerId: reminderOwnerId,
          relatedType: relatedType ?? "call",
          relatedId: relatedId ?? id,
        })
      } else {
        // Correcting the outcome must correct the promise as well. Keeping a
        // stale scheduled callback after changing to "interested" is worse than
        // no schedule: someone will call a customer who is not expecting it.
        await tx.activity.deleteMany({
          where: { id: activityId, organizationId: orgId },
        })
        await tx.task.updateMany({
          where: {
            organizationId: orgId,
            deletedAt: null,
            OR: [
              { id: activityId },
              {
                customFields: {
                  path: [COMMITMENT_CALL_FIELD],
                  equals: id,
                },
              },
            ],
          },
          // Task comments, checklists, attachments and audit history all hang
          // off this row. Correcting an outcome cancels the promise; it must
          // not physically cascade-delete the evidence that it once existed.
          data: {
            status: "cancelled",
            deletedAt: new Date(),
          },
        })
      }

      return { found: true }
    })
    if (!result.found) {
      return NextResponse.json({ error: "Call not found" }, { status: 404 })
    }
    return NextResponse.json({
      success: true,
      ...(callbackAt ? { callbackAt: callbackAt.toISOString() } : {}),
    })
  } catch (e) {
    if (e instanceof CallbackTaskConflict) {
      return NextResponse.json({ error: "callback_task_changed" }, { status: 409 })
    }
    console.error("Disposition error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

class CallbackTaskConflict extends Error {}

type CallbackTaskClient = Pick<Prisma.TransactionClient, "task">

async function scheduleCallbackReminder(
  tx: CallbackTaskClient,
  input: {
    organizationId: string
    callId: string
    dueDate: Date
    ownerId: string
    relatedType: string
    relatedId: string
  },
) {
  const canonicalId = callbackReminderId(input.callId)
  const matches = await tx.task.findMany({
    where: {
      organizationId: input.organizationId,
      deletedAt: null,
      OR: [
        { id: canonicalId },
        {
          customFields: {
            path: [COMMITMENT_CALL_FIELD],
            equals: input.callId,
          },
        },
      ],
    },
    select: {
      id: true,
      createdAt: true,
      updatedAt: true,
      customFields: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  })
  // Active reads exclude soft-deleted rows globally. A correction may later be
  // corrected back to callback, so explicitly recover the canonical row and
  // clear its old delivery stamps without erasing its history/custom fields.
  const [deletedCanonical] = matches.length === 0
    ? await tx.task.findMany({
        where: {
          id: canonicalId,
          organizationId: input.organizationId,
          deletedAt: { not: null },
        },
        select: {
          id: true,
          createdAt: true,
          updatedAt: true,
          customFields: true,
        },
        take: 1,
      })
    : []
  const existing = matches.find((task) => task.id === canonicalId)
    ?? matches[0]
    ?? deletedCanonical

  if (!existing) {
    // The update arm is deliberately narrow. It is reached when an AI writer
    // from an overlapping deployment won the deterministic-id race; its
    // owner/title/relation/custom data belongs to that row and must survive the
    // manual retry.
    await tx.task.upsert({
      where: { id: canonicalId },
      create: {
        id: canonicalId,
        organizationId: input.organizationId,
        title: "Callback",
        dueDate: input.dueDate,
        assignedTo: input.ownerId,
        relatedType: input.relatedType,
        relatedId: input.relatedId,
        createdBy: input.ownerId,
        customFields: {
          [COMMITMENT_CALL_FIELD]: input.callId,
          callbackSource: "manual-disposition",
        },
      },
      update: {
        dueDate: input.dueDate,
        status: "pending",
        completedAt: null,
        deletedAt: null,
      },
    })
    return
  }

  const customFields = jsonObject(existing.customFields)
  delete customFields.overdueNotifiedAt
  delete customFields.escalatedAt
  customFields[COMMITMENT_CALL_FIELD] = input.callId
  customFields.callbackSource = "manual-disposition"

  const changed = await tx.task.updateMany({
    where: {
      id: existing.id,
      organizationId: input.organizationId,
      updatedAt: existing.updatedAt,
    },
    data: {
      dueDate: input.dueDate,
      status: "pending",
      completedAt: null,
      deletedAt: null,
      customFields: customFields as Prisma.InputJsonValue,
    },
  })
  if (changed.count !== 1) throw new CallbackTaskConflict()

  const duplicates = matches.filter((task) => task.id !== existing.id)
  for (const duplicate of duplicates) {
    const cancelled = await tx.task.updateMany({
      where: {
        id: duplicate.id,
        organizationId: input.organizationId,
        updatedAt: duplicate.updatedAt,
        deletedAt: null,
      },
      data: {
        status: "cancelled",
        deletedAt: new Date(),
      },
    })
    if (cancelled.count !== 1) throw new CallbackTaskConflict()
  }
}

function jsonObject(value: Prisma.JsonValue | null): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return { ...(value as Record<string, unknown>) }
}
