import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { computeNextStepAt } from "@/lib/sequences"
import { suppressSequenceEmail } from "@/lib/sequence-unsubscribe"
import { withRlsAuth } from "@/lib/with-rls"
import type { Prisma } from "@prisma/client"

const bodySchema = z.object({
  /// done = touch performed; no_answer = attempted, nobody picked up;
  /// skipped = move on without doing it; opt_out = the person asked to never
  /// be contacted again (E3: suppresses their email org-wide and stops every
  /// enrollment on that address)
  outcome: z.enum(["done", "no_answer", "skipped", "opt_out"]),
  note: z.string().max(2000).optional(),
})

/**
 * POST /api/v1/sequences/enrollments/[enrollmentId]/complete-step
 *
 * Manager marks the current touch as handled from the touch queue: logs an
 * Activity and advances the enrollment (same semantics as the cron advance —
 * currentStep+1 with nextStepAt from the next step's delay, or completed).
 */
export const POST = withRlsAuth(undefined, undefined, async (req, auth, { params }: { params: Promise<{ enrollmentId: string }> }) => {
  const { enrollmentId } = await params

  const body = await req.json()
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.flatten() },
      { status: 400 }
    )
  }
  const { outcome, note } = parsed.data

  const enrollment = await prisma.sequenceEnrollment.findFirst({
    where: { id: enrollmentId, organizationId: auth.orgId },
    include: {
      sequence: {
        include: { steps: { where: { isActive: true }, orderBy: { stepOrder: "asc" } } },
      },
    },
  })
  if (!enrollment) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (enrollment.status !== "active") {
    return NextResponse.json({ error: `Enrollment is ${enrollment.status}, not active` }, { status: 409 })
  }

  const steps = enrollment.sequence.steps
  const step = steps[enrollment.currentStep]
  const now = new Date()

  const STALE_TOUCH_ERROR =
    "Touch already advanced (by the runner or another user) — refresh the queue"

  // Ran out of steps (steps edited under the enrollment) — just complete it.
  // Guarded: another writer may have completed/stopped it since our read.
  if (!step) {
    const res = await prisma.sequenceEnrollment.updateMany({
      where: { id: enrollment.id, organizationId: auth.orgId, status: "active" },
      data: { status: "completed", completedAt: now, nextStepAt: null },
    })
    if (res.count === 0) {
      return NextResponse.json({ error: STALE_TOUCH_ERROR }, { status: 409 })
    }
    const updated = await prisma.sequenceEnrollment.findFirst({
      where: { id: enrollment.id, organizationId: auth.orgId },
    })
    return NextResponse.json({ success: true, data: updated })
  }

  // ── E3: «Opt-out» outcome — the person asked to never be contacted. Stop
  // THIS enrollment with exitReason opted_out, log the activity, and when the
  // entity has an email — suppress it org-wide (stops every other enrollment
  // on the address too). No advance: the cadence is over for this person. ──
  if (outcome === "opt_out") {
    const claim = await prisma.sequenceEnrollment.updateMany({
      where: { id: enrollment.id, organizationId: auth.orgId, status: "active", currentStep: enrollment.currentStep },
      data: { status: "stopped", stoppedAt: now, nextStepAt: null, exitReason: "opted_out", lastOutcome: "opt_out" },
    })
    if (claim.count === 0) {
      return NextResponse.json({ error: STALE_TOUCH_ERROR }, { status: 409 })
    }
    await prisma.activity.create({
      data: {
        organizationId: auth.orgId,
        type: step.type === "call" ? "call" : "task",
        subject: `${enrollment.sequence.name} — step ${enrollment.currentStep + 1}/${steps.length}: opt-out${step.subject ? ` — ${step.subject}` : ""}`,
        description: note ?? undefined,
        relatedType: enrollment.entityType,
        relatedId: enrollment.entityId,
        ...(enrollment.entityType === "contact" ? { contactId: enrollment.entityId } : {}),
        createdBy: auth.userId,
        completedAt: now,
      },
    }).catch(() => null)

    let entityEmail: string | null = null
    if (enrollment.entityType === "contact") {
      const c = await prisma.contact.findFirst({
        where: { id: enrollment.entityId, organizationId: auth.orgId },
        select: { email: true },
      })
      entityEmail = c?.email ?? null
    } else {
      const l = await prisma.lead.findFirst({
        where: { id: enrollment.entityId, organizationId: auth.orgId },
        select: { email: true },
      })
      entityEmail = l?.email ?? null
    }
    // `suppressed` reports what actually happened — a swallowed failure must
    // not tell the rep the person is safe from further outreach when they
    // are not.
    let suppressed = false
    if (entityEmail) {
      suppressed = await suppressSequenceEmail(prisma, {
        organizationId: auth.orgId,
        email: entityEmail,
        reason: "call_opt_out",
      })
        .then(() => true)
        .catch(() => false)
    }

    const updated = await prisma.sequenceEnrollment.findFirst({
      where: { id: enrollment.id, organizationId: auth.orgId },
    })
    return NextResponse.json({ success: true, data: updated, suppressed })
  }

  const nextStep = steps[enrollment.currentStep + 1]

  // Guarded claim + activity log in one transaction. The claim is conditioned
  // on status+currentStep from our read: if the runner cron (or another user)
  // advanced the enrollment in between, count is 0 → 409, no duplicate
  // side-effects and no completing the WRONG step.
  const claimed = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const claim = await tx.sequenceEnrollment.updateMany({
      where: {
        id: enrollment.id,
        organizationId: auth.orgId,
        status: "active",
        currentStep: enrollment.currentStep,
      },
      data: nextStep
        ? {
            currentStep: enrollment.currentStep + 1,
            nextStepAt: computeNextStepAt(now, nextStep.delayDays, { workdaysOnly: enrollment.sequence.workdaysOnly }),
            lastOutcome: outcome,
          }
        : {
            currentStep: enrollment.currentStep + 1,
            status: "completed",
            completedAt: now,
            nextStepAt: null,
            lastOutcome: outcome,
          },
    })
    if (claim.count === 0) return false

    // Log what the manager actually did. Activity.subject (not title) — schema field.
    await tx.activity.create({
      data: {
        organizationId: auth.orgId,
        type: step.type === "email" ? "email" : step.type === "call" ? "call" : "task",
        subject: `${enrollment.sequence.name} — step ${enrollment.currentStep + 1}/${steps.length}: ${outcome}${step.subject ? ` — ${step.subject}` : ""}`,
        description: note ?? undefined,
        relatedType: enrollment.entityType,
        relatedId: enrollment.entityId,
        ...(enrollment.entityType === "contact" ? { contactId: enrollment.entityId } : {}),
        createdBy: auth.userId,
        completedAt: now,
      },
    })
    return true
  })

  if (!claimed) {
    return NextResponse.json({ error: STALE_TOUCH_ERROR }, { status: 409 })
  }

  const updated = await prisma.sequenceEnrollment.findFirst({
    where: { id: enrollment.id, organizationId: auth.orgId },
  })
  return NextResponse.json({ success: true, data: updated })
})
