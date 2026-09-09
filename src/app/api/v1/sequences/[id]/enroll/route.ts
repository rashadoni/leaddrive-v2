import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { enrollOne } from "@/lib/sequences-enroll"
import { readSingleActiveEnrollment } from "@/lib/sequence-enrollment-policy"
import { withRlsAuth } from "@/lib/with-rls"

const enrollSchema = z.object({
  entityType: z.enum(["lead", "contact"]),
  entityId: z.string().min(1),
})

export const POST = withRlsAuth(undefined, undefined, async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id: sequenceId } = await params

  const sequence = await prisma.salesSequence.findFirst({
    where: { id: sequenceId, organizationId: auth.orgId, isActive: true },
    include: { steps: { where: { isActive: true }, orderBy: { stepOrder: "asc" } } },
  })
  if (!sequence) return NextResponse.json({ error: "Sequence not found or inactive" }, { status: 404 })
  if (sequence.steps.length === 0) {
    return NextResponse.json({ error: "Sequence has no active steps" }, { status: 422 })
  }

  const parsed = enrollSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation error", details: parsed.error.flatten() }, { status: 400 })
  }
  const { entityType, entityId } = parsed.data

  const org = await prisma.organization.findUnique({ where: { id: auth.orgId }, select: { settings: true } })

  const result = await enrollOne({
    orgId: auth.orgId,
    userId: auth.userId,
    sequenceId,
    firstStepDelayDays: sequence.steps[0].delayDays,
    entityType,
    entityId,
    workdaysOnly: sequence.workdaysOnly,
    singleActiveEnrollment: readSingleActiveEnrollment(org?.settings),
  })

  if (result.outcome === "not_found") {
    return NextResponse.json({ error: entityType === "lead" ? "Lead not found" : "Contact not found" }, { status: 404 })
  }
  if (result.outcome === "already_enrolled") {
    return NextResponse.json({ error: "Entity already enrolled in this sequence", data: result.enrollment }, { status: 409 })
  }
  // E6 — already in another active sequence and the org enforces single-active.
  if (result.outcome === "blocked_other_sequence") {
    return NextResponse.json(
      { error: "This contact is already in another active sequence", blockedByOtherSequence: true, data: result.enrollment },
      { status: 409 },
    )
  }
  return NextResponse.json({ success: true, data: result.enrollment }, { status: 201 })
})
