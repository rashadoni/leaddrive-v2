import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { sendEmail } from "@/lib/email"
import { computeNextStepAt } from "@/lib/sequences"
import {
  parseThreading,
  planThreadedSend,
  generateSequenceMessageId,
  resolveReplyTarget,
  type ThreadMode,
} from "@/lib/sequence-threading"
import { isSequenceEmailSuppressed, applyUnsubscribeToEmail } from "@/lib/sequence-unsubscribe"
import { getDailyLimitStatus } from "@/lib/sequence-send-limit"
import { withRlsAuth } from "@/lib/with-rls"

const bodySchema = z.object({
  subject: z.string().min(1).max(500),
  body: z.string().min(1), // HTML — already variable-rendered by the composer
  note: z.string().max(2000).optional(),
})

/**
 * POST /api/v1/sequences/enrollments/[enrollmentId]/send-email
 *
 * Sends the email step for real (SMTP/Resend of the org via sendEmail), logs an
 * Activity, and advances the enrollment.
 *
 * Ordering: send FIRST, then guarded-advance. This guarantees we never advance
 * a touch whose email failed to send (the touch stays in the queue with the
 * error surfaced). The only residual window is two humans clicking Send on the
 * SAME touch concurrently → two sends; the per-browser busy lock covers the
 * common case, and for a human-initiated send a rare double is preferable to a
 * lost send. The advance itself is race-safe (updateMany on status+currentStep):
 * if the runner or another writer already moved on, we simply don't double-advance.
 */
export const POST = withRlsAuth(undefined, undefined, async (req, auth, { params }: { params: Promise<{ enrollmentId: string }> }) => {
  const { enrollmentId } = await params

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation error", details: parsed.error.flatten() }, { status: 400 })
  }
  const { subject, body, note } = parsed.data

  const enrollment = await prisma.sequenceEnrollment.findFirst({
    where: { id: enrollmentId, organizationId: auth.orgId },
    include: { sequence: { include: { steps: { where: { isActive: true }, orderBy: { stepOrder: "asc" } } } } },
  })
  if (!enrollment) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (enrollment.status !== "active") {
    return NextResponse.json({ error: `Enrollment is ${enrollment.status}, not active` }, { status: 409 })
  }

  const steps = enrollment.sequence.steps
  const step = steps[enrollment.currentStep]
  if (!step) return NextResponse.json({ error: "No current step" }, { status: 409 })
  if (step.type !== "email") {
    return NextResponse.json({ error: "Current step is not an email step" }, { status: 400 })
  }

  // Resolve recipient email + (for contacts) the contactId to attribute the send.
  let toEmail: string | null = null
  let contactId: string | undefined
  if (enrollment.entityType === "lead") {
    const lead = await prisma.lead.findFirst({
      where: { id: enrollment.entityId, organizationId: auth.orgId },
      select: { email: true },
    })
    toEmail = lead?.email ?? null
  } else {
    const contact = await prisma.contact.findFirst({
      where: { id: enrollment.entityId, organizationId: auth.orgId },
      select: { id: true, email: true },
    })
    toEmail = contact?.email ?? null
    contactId = contact?.id
  }
  if (!toEmail) {
    return NextResponse.json({ error: "No email address on record for this contact" }, { status: 422 })
  }

  // E3 — suppression check BEFORE every send (transactional sendEmail bypasses
  // the marketing opt-out by design, so the cadence enforces it itself). An
  // opted-out recipient also STOPS the enrollment: the queue must not keep
  // asking to email someone who said no.
  if (await isSequenceEmailSuppressed(prisma, auth.orgId, toEmail)) {
    await prisma.sequenceEnrollment.updateMany({
      where: { id: enrollment.id, organizationId: auth.orgId, status: "active" },
      data: { status: "stopped", stoppedAt: new Date(), nextStepAt: null, exitReason: "opted_out" },
    })
    return NextResponse.json({ error: "Recipient unsubscribed from emails", optedOut: true }, { status: 422 })
  }

  // E4 — daily send limit. Once the org's cap is hit, refuse for the rest of
  // the UTC day WITHOUT advancing or stopping: the touch stays due, so the
  // excess rolls to tomorrow (domain-reputation protection).
  const org = await prisma.organization.findUnique({
    where: { id: auth.orgId },
    select: { settings: true },
  })
  const limit = await getDailyLimitStatus(prisma, auth.orgId, org?.settings)
  if (limit.reached) {
    return NextResponse.json(
      { error: "Daily sequence email limit reached — try again tomorrow", limitReached: true, limit: limit.limit, sentToday: limit.sentToday },
      { status: 429 },
    )
  }

  // E1 threading: follow-ups ride the enrollment's thread. We mint our own
  // Message-ID, and when the step continues the thread we stamp
  // In-Reply-To/References (anchored on the recipient's own reply when they
  // have answered into the thread) and force the «Re: root» subject — that is
  // the feature's contract, so it applies regardless of what the composer
  // field contained.
  const threading = parseThreading(enrollment.threading)
  const mode: ThreadMode = step.threadMode === "new" ? "new" : "continue"
  // The reply lookup only matters when we are actually continuing the thread.
  const replyTargetId =
    mode === "continue"
      ? await resolveReplyTarget(prisma, { organizationId: auth.orgId, contactId, threading })
      : null
  const plan = planThreadedSend({
    threading,
    mode,
    subject,
    newMessageId: generateSequenceMessageId(),
    replyTargetId,
  })

  // E3 — every sequence email carries the unsubscribe footer + RFC 8058
  // one-click headers. Bilingual label: the recipient's locale is unknown.
  const unsub = applyUnsubscribeToEmail({
    organizationId: auth.orgId,
    email: toEmail,
    html: body,
    headers: plan.headers,
    label: "Отписаться / Unsubscribe",
  })

  // Send first — transactional so it isn't suppressed by marketing opt-out
  // (a cadence email a rep personally sends is 1:1 outreach, not a campaign;
  // the cadence-level suppression above is the opt-out that applies here).
  const result = await sendEmail({
    to: toEmail,
    subject: plan.subject,
    html: unsub.html,
    headers: unsub.headers,
    organizationId: auth.orgId,
    contactId,
    sentBy: auth.userId,
    sequenceId: enrollment.sequenceId, // E4/E5 — tag the log for the daily count + step stats
    transactional: true,
  })
  if (!result.success) {
    // Not configured / send failed → do NOT advance; let the UI surface the error
    // and offer the manual-send fallback. 502 = upstream (mail) problem.
    return NextResponse.json({ error: result.error ?? "Failed to send email" }, { status: 502 })
  }

  // Sent — now advance (race-safe). Log what was sent.
  const now = new Date()
  const nextStep = steps[enrollment.currentStep + 1]
  await prisma.activity.create({
    data: {
      organizationId: auth.orgId,
      type: "email",
      subject: `${enrollment.sequence.name} — step ${enrollment.currentStep + 1}/${steps.length}: sent — ${subject}`,
      description: note ?? undefined,
      relatedType: enrollment.entityType,
      relatedId: enrollment.entityId,
      ...(enrollment.entityType === "contact" ? { contactId: enrollment.entityId } : {}),
      createdBy: auth.userId,
      completedAt: now,
    },
  })
  await prisma.sequenceEnrollment.updateMany({
    where: { id: enrollment.id, organizationId: auth.orgId, status: "active", currentStep: enrollment.currentStep },
    data: nextStep
      ? { currentStep: enrollment.currentStep + 1, nextStepAt: computeNextStepAt(now, nextStep.delayDays, { workdaysOnly: enrollment.sequence.workdaysOnly }), lastOutcome: "done", threading: plan.nextThreading }
      : { currentStep: enrollment.currentStep + 1, status: "completed", completedAt: now, nextStepAt: null, lastOutcome: "done", threading: plan.nextThreading },
  })

  return NextResponse.json({ success: true, messageId: result.messageId, subject: plan.subject, threaded: !!plan.headers["In-Reply-To"] })
})
