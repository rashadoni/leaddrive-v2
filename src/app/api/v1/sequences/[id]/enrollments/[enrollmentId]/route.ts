import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { z } from "zod"

// Either change the status, or snooze the next touch by N days. Exactly one.
const patchSchema = z.union([
  z.object({ status: z.enum(["active", "paused", "stopped"]) }),
  z.object({ snoozeDays: z.number().int().min(1).max(30) }),
])

export const PATCH = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string; enrollmentId: string }> }) => {
  const { id: sequenceId, enrollmentId } = await params

  const enrollment = await prisma.sequenceEnrollment.findFirst({
    where: { id: enrollmentId, sequenceId, organizationId: orgId as string },
  })
  if (!enrollment) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const parsed = patchSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation error", details: parsed.error.flatten() }, { status: 400 })
  }

  const now = new Date()

  // Snooze: push the next touch out by N days from whichever is later (its due
  // date or now), so snoozing an overdue touch actually delays it. Only active
  // enrollments have a pending touch to move.
  if ("snoozeDays" in parsed.data) {
    if (enrollment.status !== "active") {
      return NextResponse.json({ error: `Cannot snooze a ${enrollment.status} enrollment` }, { status: 409 })
    }
    const base = enrollment.nextStepAt && enrollment.nextStepAt > now ? enrollment.nextStepAt : now
    const updated = await prisma.sequenceEnrollment.update({
      where: { id: enrollmentId },
      data: { nextStepAt: new Date(base.getTime() + parsed.data.snoozeDays * 86_400_000), lastOutcome: "snoozed" },
    })
    return NextResponse.json({ success: true, data: updated })
  }

  const { status } = parsed.data
  const updated = await prisma.sequenceEnrollment.update({
    where: { id: enrollmentId },
    data: {
      status,
      ...(status === "stopped" ? { stoppedAt: now, nextStepAt: null, exitReason: "manual" } : {}),
      ...(status === "active" && enrollment.status === "paused" ? { nextStepAt: now } : {}),
    },
  })

  return NextResponse.json({ success: true, data: updated })
})
