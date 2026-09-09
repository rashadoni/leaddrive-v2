import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { Prisma } from "@prisma/client"
import { computeNextStepAt, OWNED_TOUCH_GRACE_MS } from "@/lib/sequences"
import { runWithRlsBypass } from "@/lib/rls-context"

/**
 * S3 Sales Sequences runner cron.
 *
 * Finds enrollments whose nextStepAt is in the past, executes the next step
 * (creates a Task for call/task types, or logs an Activity for email type),
 * then advances currentStep or marks the enrollment completed.
 *
 * Cadence semantics: OWNER-MANAGED enrollments (ownerId set) appear in the
 * manager's touch queue, so the cron leaves them alone for a grace window
 * (OWNED_TOUCH_GRACE_MS) — the manager works the touch via complete-step;
 * the cron is only the safety net for touches nobody handled. Ownerless
 * enrollments are auto-run immediately (pre-cadence behavior).
 *
 * Each enrollment is processed in a $transaction with a GUARDED claim
 * (updateMany conditioned on status+currentStep): if complete-step or a
 * concurrent cron run advanced the enrollment first, the claim count is 0 and
 * the side-effect is skipped — no duplicate task/activity. If the side-effect
 * create fails, the transaction rolls back the claim.
 *
 * Wire to external cron every 15 minutes:
 *   curl -X POST https://app.leaddrivecrm.org/api/cron/sequences \
 *        -H "x-cron-secret: $CRON_SECRET"
 */

const BATCH_SIZE = 200

export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  const now = new Date()
  const ownedCutoff = new Date(now.getTime() - OWNED_TOUCH_GRACE_MS)

  // Fetch active enrollments that are ready to advance.
  // Filter sequence.isActive: true so that toggling a sequence inactive
  // stops the cron from processing its enrollments without needing to
  // individually stop each enrollment row.
  const ready = await prisma.sequenceEnrollment.findMany({
    where: {
      status: "active",
      sequence: { isActive: true },
      OR: [
        { ownerId: null, nextStepAt: { lte: now } },
        { ownerId: { not: null }, nextStepAt: { lte: ownedCutoff } },
      ],
    },
    include: {
      sequence: {
        include: {
          steps: { where: { isActive: true }, orderBy: { stepOrder: "asc" } },
        },
      },
    },
    take: BATCH_SIZE,
    orderBy: { nextStepAt: "asc" },
  })

  let advanced = 0
  let completed = 0
  let skipped = 0
  let errors = 0

  for (const enrollment of ready) {
    const steps = enrollment.sequence.steps

    if (steps.length === 0 || enrollment.currentStep >= steps.length) {
      // Sequence has no active steps, or all done already. Guarded: another
      // writer (complete-step) may have already completed/stopped it.
      const res = await prisma.sequenceEnrollment.updateMany({
        where: { id: enrollment.id, status: "active" },
        data: { status: "completed", completedAt: now, nextStepAt: null },
      })
      if (res.count > 0) completed++
      else skipped++
      continue
    }

    const step = steps[enrollment.currentStep] // 0-based: currentStep = # already executed

    try {
      const newCurrentStep = enrollment.currentStep + 1
      const nextStep = steps[newCurrentStep] ?? null

      // Atomic: guarded claim + side-effect in one transaction. Claim FIRST so
      // a lost race skips the side-effect; a failed side-effect rolls back the claim.
      const claimed = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const claim = await tx.sequenceEnrollment.updateMany({
          where: {
            id: enrollment.id,
            status: "active",
            currentStep: enrollment.currentStep,
          },
          data: nextStep
            ? {
                currentStep: newCurrentStep,
                nextStepAt: computeNextStepAt(now, nextStep.delayDays, { workdaysOnly: enrollment.sequence.workdaysOnly }),
              }
            : {
                status: "completed",
                completedAt: now,
                nextStepAt: null,
                currentStep: newCurrentStep,
              },
        })
        if (claim.count === 0) return false

        // call / task / sms / whatsapp are rep-actioned touches → create a Task.
        // Only email is auto-logged as an Activity (it can be sent from the queue).
        if (step.type !== "email") {
          const kindLabel = step.type === "call" ? "Call" : step.type === "sms" ? "SMS" : step.type === "whatsapp" ? "WhatsApp" : "Task"
          await tx.task.create({
            data: {
              organizationId: enrollment.organizationId,
              title:
                step.subject ??
                `${kindLabel} — Sequence: ${enrollment.sequence.name}`,
              description: step.body ?? undefined,
              relatedType: enrollment.entityType,
              relatedId: enrollment.entityId,
              status: "pending",
              priority: "medium",
              dueDate: now,
            },
          })
        } else if (step.type === "email") {
          // Activity.subject (not title) per prisma/schema.prisma Activity model
          await tx.activity.create({
            data: {
              organizationId: enrollment.organizationId,
              type: "sequence_email",
              subject:
                step.subject ??
                `Email — Sequence: ${enrollment.sequence.name}`,
              description: step.body ?? undefined,
              relatedType: enrollment.entityType,
              relatedId: enrollment.entityId,
            },
          })
        }
        return true
      })

      if (!claimed) {
        skipped++
      } else if (nextStep) {
        advanced++
      } else {
        completed++
      }
    } catch (err) {
      console.error(
        `[cron/sequences] Error processing enrollment ${enrollment.id}:`,
        err
      )
      errors++
    }
  }

  return NextResponse.json({
    success: true,
    processed: ready.length,
    advanced,
    completed,
    skipped,
    errors,
  })
  })
}
