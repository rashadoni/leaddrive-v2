import { prisma } from "@/lib/prisma"
import { createNotification } from "@/lib/notifications"

/**
 * Cadence auto-exit + E2 reply reactions.
 *
 * Stops/pauses a person's active sequence enrollments when they reply, a
 * meeting is logged, or their deal closes — so the manager's touch queue
 * never asks to chase someone who already responded.
 *
 * Reply semantics (E2):
 *   • per-sequence reaction "stop" | "pause" | "continue"
 *     (SalesSequence.replyReaction; null = legacy exitOnReply-derived) —
 *     resolveReplyReaction() is the single source of that rule;
 *   • every reply additionally creates a follow-up TASK for the queue owner
 *     («клиент ответил» — the reply must be worked, not just noted);
 *   • a THIRD PARTY replying into the thread (fromEmail doesn't match the
 *     enrolled person) only alerts the owner — the cadence keeps running and
 *     repliedAt is NOT stamped.
 *
 * meeting_booked / deal_closed keep the boolean exitOn* behavior.
 *
 * MUST be awaited inside an RLS context (runWithTenant / withRls handler /
 * runWithRlsBypass) — the queries run on the caller's tenant connection.
 * Never throws: auto-exit is a side-effect; the caller's flow must not break.
 */
export type CadenceExitTrigger = "replied" | "meeting_booked" | "deal_closed"

export type ReplyReaction = "stop" | "pause" | "continue"

/** The ONE place the per-sequence reply rule is derived (null = legacy flag). */
export function resolveReplyReaction(seq: { replyReaction?: string | null; exitOnReply: boolean }): ReplyReaction {
  if (seq.replyReaction === "stop" || seq.replyReaction === "pause" || seq.replyReaction === "continue") {
    return seq.replyReaction
  }
  return seq.exitOnReply ? "stop" : "continue"
}

const TRIGGER_FLAG: Record<Exclude<CadenceExitTrigger, "replied">, "exitOnMeeting" | "exitOnDealClosed"> = {
  meeting_booked: "exitOnMeeting",
  deal_closed: "exitOnDealClosed",
}

const NOTIFICATION_TITLE: Record<CadenceExitTrigger, string> = {
  replied: "Sequence stopped — reply received",
  meeting_booked: "Sequence stopped — meeting booked",
  deal_closed: "Sequence stopped — deal closed",
}

interface EnrollmentHit {
  id: string
  sequenceId: string
  entityType: string
  entityId: string
  ownerId: string | null
  enrolledBy: string | null
  sequence: {
    name: string
    exitOnReply: boolean
    replyReaction: string | null
    exitOnMeeting: boolean
    exitOnDealClosed: boolean
  }
}

const emailsMatch = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()

export async function autoExitSequenceEnrollments(opts: {
  organizationId: string
  trigger: CadenceExitTrigger
  contactId?: string | null
  leadId?: string | null
  /** Sender email — resolves lead/contact enrollments the caller didn't match (email-inbound has no lead matching). */
  email?: string | null
  /**
   * E2 (replied only): the actual From address of the inbound email. When it
   * does NOT match the enrolled person's email, the reply is treated as a
   * third party jumping into the thread: owner gets an alert, the cadence
   * keeps running. Omit to skip the check (non-email reply channels).
   */
  fromEmail?: string | null
}): Promise<number> {
  try {
    const refs: { entityType: string; entityId: string }[] = []
    if (opts.contactId) refs.push({ entityType: "contact", entityId: opts.contactId })
    if (opts.leadId) refs.push({ entityType: "lead", entityId: opts.leadId })

    if (opts.email) {
      const [lead, contact]: [{ id: string } | null, { id: string } | null] = await Promise.all([
        opts.leadId
          ? Promise.resolve(null)
          : prisma.lead.findFirst({
              where: { organizationId: opts.organizationId, email: opts.email },
              select: { id: true },
            }),
        opts.contactId
          ? Promise.resolve(null)
          : prisma.contact.findFirst({
              where: { organizationId: opts.organizationId, email: opts.email },
              select: { id: true },
            }),
      ])
      if (lead) refs.push({ entityType: "lead", entityId: lead.id })
      if (contact) refs.push({ entityType: "contact", entityId: contact.id })
    }
    if (refs.length === 0) return 0

    // NO flag filter here: outcome timestamps (repliedAt/meetingBookedAt) are
    // ANALYTICS data and must be stamped regardless of the exit rule — only the
    // status transition is gated on the sequence's rule.
    const enrollments: EnrollmentHit[] = await prisma.sequenceEnrollment.findMany({
      where: {
        organizationId: opts.organizationId,
        status: "active",
        OR: refs,
      },
      select: {
        id: true,
        sequenceId: true,
        entityType: true,
        entityId: true,
        ownerId: true,
        enrolledBy: true,
        sequence: {
          select: {
            name: true,
            exitOnReply: true,
            replyReaction: true,
            exitOnMeeting: true,
            exitOnDealClosed: true,
          },
        },
      },
    })
    if (enrollments.length === 0) return 0

    const now = new Date()

    // ── E2: third-party detection is PER ENROLLMENT — the sender may be a
    // legitimate contact of the org (their OWN enrollments react to their own
    // reply via the `email` resolution) while still being a stranger to
    // SOMEONE ELSE's thread. An enrollment whose entity has NO email on file
    // cannot be verified → treated as third-party too (alert, don't stop). ──
    let selfEnrollments = enrollments
    let thirdPartyEnrollments: EnrollmentHit[] = []
    if (opts.trigger === "replied" && opts.fromEmail) {
      const from = opts.fromEmail.trim().toLowerCase()
      const contactIds = [...new Set(enrollments.filter((e) => e.entityType === "contact").map((e) => e.entityId))]
      const leadIds = [...new Set(enrollments.filter((e) => e.entityType === "lead").map((e) => e.entityId))]
      const [contacts, leads] = await Promise.all([
        contactIds.length
          ? prisma.contact.findMany({
              where: { organizationId: opts.organizationId, id: { in: contactIds } },
              select: { id: true, email: true },
            })
          : Promise.resolve([]),
        leadIds.length
          ? prisma.lead.findMany({
              where: { organizationId: opts.organizationId, id: { in: leadIds } },
              select: { id: true, email: true },
            })
          : Promise.resolve([]),
      ])
      const emailByEntity = new Map<string, string | null>()
      for (const c of contacts) emailByEntity.set(`contact:${c.id}`, c.email?.trim().toLowerCase() || null)
      for (const l of leads) emailByEntity.set(`lead:${l.id}`, l.email?.trim().toLowerCase() || null)

      selfEnrollments = []
      for (const e of enrollments) {
        const entityEmail = emailByEntity.get(`${e.entityType}:${e.entityId}`) ?? null
        if (entityEmail === from) selfEnrollments.push(e)
        else thirdPartyEnrollments.push(e)
      }

      if (thirdPartyEnrollments.length > 0) {
        await Promise.all(
          thirdPartyEnrollments.map((e) => {
            const userId = e.ownerId ?? e.enrolledBy
            if (!userId) return null
            return createNotification({
              organizationId: opts.organizationId,
              userId,
              type: "warning",
              title: "Third-party reply in sequence thread",
              message: `«${e.sequence.name}» — ${opts.fromEmail} replied in the thread (not the enrolled person). Cadence keeps running.`,
              entityType: "sequence",
              entityId: e.sequenceId,
            })
          }),
        )
      }
      if (selfEnrollments.length === 0) return 0
    }

    const stamp =
      opts.trigger === "replied" ? { repliedAt: now }
      : opts.trigger === "meeting_booked" ? { meetingBookedAt: now }
      : {}

    let toStop: EnrollmentHit[] = []
    let toPause: EnrollmentHit[] = []
    let toStampOnly: EnrollmentHit[] = []
    if (opts.trigger === "replied") {
      for (const e of selfEnrollments) {
        const reaction = resolveReplyReaction(e.sequence)
        if (reaction === "stop") toStop.push(e)
        else if (reaction === "pause") toPause.push(e)
        else toStampOnly.push(e)
      }
    } else {
      const flag = TRIGGER_FLAG[opts.trigger]
      toStop = enrollments.filter((e) => e.sequence[flag])
      toStampOnly = enrollments.filter((e) => !e.sequence[flag])
    }

    if (toStop.length > 0) {
      await prisma.sequenceEnrollment.updateMany({
        where: { id: { in: toStop.map((e) => e.id) } },
        data: {
          status: "stopped",
          stoppedAt: now,
          nextStepAt: null,
          exitReason: opts.trigger,
          ...stamp,
        },
      })
    }
    if (toPause.length > 0) {
      // Paused keeps the enrollment (and its thread state) resumable from the
      // enrollments UI; nextStepAt survives so resume just re-activates.
      await prisma.sequenceEnrollment.updateMany({
        where: { id: { in: toPause.map((e) => e.id) } },
        data: { status: "paused", ...stamp },
      })
    }
    if (toStampOnly.length > 0 && Object.keys(stamp).length > 0) {
      // Exit rule is off for these sequences — record the outcome, keep running.
      // Only fill empty timestamps so the FIRST reply/meeting is what analytics see.
      const field = opts.trigger === "replied" ? "repliedAt" : "meetingBookedAt"
      await prisma.sequenceEnrollment.updateMany({
        where: { id: { in: toStampOnly.map((e) => e.id) }, [field]: null },
        data: stamp,
      })
    }

    // ── E2: a reply must be WORKED — ONE follow-up task per person, deduped
    // against a still-open reply task (a chatty thread or an enrollee in N
    // sequences must not flood the owner's queue). ──
    if (opts.trigger === "replied") {
      const TASK_MARKER = "Client replied"
      const byEntity = new Map<string, EnrollmentHit[]>()
      for (const e of selfEnrollments) {
        const key = `${e.entityType}:${e.entityId}`
        byEntity.set(key, [...(byEntity.get(key) ?? []), e])
      }
      await Promise.all(
        [...byEntity.values()].map(async (group) => {
          const first = group[0]
          try {
            const open = await prisma.task.findFirst({
              where: {
                organizationId: opts.organizationId,
                relatedType: first.entityType,
                relatedId: first.entityId,
                status: "pending",
                title: { startsWith: TASK_MARKER },
              },
              select: { id: true },
            })
            if (open) return
            const seqNames = [...new Set(group.map((e) => e.sequence.name))].join(", ")
            await prisma.task.create({
              data: {
                organizationId: opts.organizationId,
                title: `${TASK_MARKER} — «${seqNames}»`,
                description: opts.fromEmail
                  ? `Inbound reply from ${opts.fromEmail}. Respond while the conversation is warm.`
                  : "Inbound reply on the cadence. Respond while the conversation is warm.",
                relatedType: first.entityType,
                relatedId: first.entityId,
                status: "pending",
                priority: "high",
                dueDate: now,
                assignedTo: first.ownerId ?? first.enrolledBy ?? undefined,
              },
            })
          } catch {
            /* best-effort */
          }
        }),
      )
    }

    // Tell each queue owner their touch is gone/paused (best-effort)
    await Promise.all(
      [...toStop, ...toPause].map((e) => {
        const userId = e.ownerId ?? e.enrolledBy
        if (!userId) return null
        const paused = toPause.includes(e)
        return createNotification({
          organizationId: opts.organizationId,
          userId,
          type: "info",
          title: paused ? "Sequence paused — reply received" : NOTIFICATION_TITLE[opts.trigger],
          message: `«${e.sequence.name}» — enrollment ${paused ? "paused" : "exited"} (${opts.trigger.replace("_", " ")})`,
          entityType: "sequence",
          entityId: e.sequenceId,
        })
      })
    )

    return toStop.length + toPause.length
  } catch (err) {
    console.error("[sequence-auto-exit] failed (non-fatal):", err)
    return 0
  }
}
