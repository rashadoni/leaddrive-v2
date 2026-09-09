import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { withRls } from "@/lib/with-rls"
import { z } from "zod"

const stepSchema = z.object({
  id: z.string().optional(), // omit = new step
  stepOrder: z.number().int().min(1),
  type: z.enum(["email", "call", "task", "sms", "whatsapp"]),
  delayDays: z.number().int().min(0).default(0),
  subject: z.string().max(500).nullish(),
  body: z.string().nullish(),
  isActive: z.boolean().optional().default(true),
  // E1 email threading: follow-up rides the thread ("continue") or starts a new one
  threadMode: z.enum(["continue", "new"]).optional().default("continue"),
})

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  exitOnReply: z.boolean().optional(),
  replyReaction: z.enum(["stop", "pause", "continue"]).nullish(),
  exitOnMeeting: z.boolean().optional(),
  exitOnDealClosed: z.boolean().optional(),
  autoEnrollSources: z.array(z.string().min(1).max(60)).max(20).optional(),
  workdaysOnly: z.boolean().optional(),
  steps: z.array(stepSchema).optional(),
})

const ACTIVE_STEP_REQUIRED_ERROR = "Add at least one active step before activating the sequence"

export const GET = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const sequence = await prisma.salesSequence.findFirst({
    where: { id, organizationId: orgId as string },
    include: {
      steps: { orderBy: { stepOrder: "asc" } },
      _count: { select: { enrollments: true } },
    },
  })

  if (!sequence) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ success: true, data: sequence })
})

export const PATCH = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const existing = await prisma.salesSequence.findFirst({
    where: { id, organizationId: orgId as string },
  })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const { name, description, isActive, exitOnReply, replyReaction, exitOnMeeting, exitOnDealClosed, autoEnrollSources, workdaysOnly, steps } = parsed.data
  const willBeActive = isActive ?? existing.isActive
  const parentPatch = {
    ...(name !== undefined ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(isActive !== undefined ? { isActive } : {}),
    ...(exitOnReply !== undefined ? { exitOnReply } : {}),
    ...(replyReaction !== undefined ? { replyReaction } : {}),
    ...(exitOnMeeting !== undefined ? { exitOnMeeting } : {}),
    ...(exitOnDealClosed !== undefined ? { exitOnDealClosed } : {}),
    ...(autoEnrollSources !== undefined ? { autoEnrollSources } : {}),
    ...(workdaysOnly !== undefined ? { workdaysOnly } : {}),
  }

  if (willBeActive) {
    const activeStepCount = steps !== undefined
      ? steps.filter((step) => step.isActive !== false).length
      : await prisma.sequenceStep.count({
          where: {
            sequenceId: id,
            organizationId: orgId as string,
            isActive: true,
          },
        })

    if (activeStepCount === 0) {
      return NextResponse.json(
        { error: ACTIVE_STEP_REQUIRED_ERROR },
        { status: 422 }
      )
    }
  }

  // If steps provided, replace all + update parent atomically
  let updated
  if (steps !== undefined) {
    updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.sequenceStep.deleteMany({ where: { sequenceId: id } })
      if (steps.length > 0) {
        await tx.sequenceStep.createMany({
          data: steps.map((s) => ({
            sequenceId: id,
            organizationId: orgId as string,
            stepOrder: s.stepOrder,
            type: s.type,
            delayDays: s.delayDays ?? 0,
            subject: s.subject ?? null,
            body: s.body ?? null,
            isActive: s.isActive ?? true,
            threadMode: s.threadMode ?? "continue",
          })),
        })
      }
      return tx.salesSequence.update({
        where: { id },
        data: parentPatch,
        include: {
          steps: { orderBy: { stepOrder: "asc" } },
          _count: { select: { enrollments: true } },
        },
      })
    })
  } else {
    updated = await prisma.salesSequence.update({
      where: { id },
      data: parentPatch,
      include: {
        steps: { orderBy: { stepOrder: "asc" } },
        _count: { select: { enrollments: true } },
      },
    })
  }

  return NextResponse.json({ success: true, data: updated })
})

export const DELETE = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const existing = await prisma.salesSequence.findFirst({
    where: { id, organizationId: orgId as string },
  })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Soft-stop active enrollments before deleting
  await prisma.sequenceEnrollment.updateMany({
    where: { sequenceId: id, status: { in: ["active", "paused"] } },
    data: { status: "stopped", stoppedAt: new Date() },
  })

  await prisma.salesSequence.delete({ where: { id } })

  return NextResponse.json({ success: true })
})
