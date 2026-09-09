import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls, withRlsAuth } from "@/lib/with-rls"
import { z } from "zod"

const stepSchema = z.object({
  stepOrder: z.number().int().min(1),
  type: z.enum(["email", "call", "task", "sms", "whatsapp"]),
  delayDays: z.number().int().min(0).default(0),
  subject: z.string().max(500).nullish(),
  body: z.string().nullish(),
  isActive: z.boolean().optional().default(true),
  threadMode: z.enum(["continue", "new"]).optional().default("continue"),
})

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  isActive: z.boolean().optional().default(true),
  exitOnReply: z.boolean().optional().default(true),
  replyReaction: z.enum(["stop", "pause", "continue"]).nullish(),
  exitOnMeeting: z.boolean().optional().default(true),
  exitOnDealClosed: z.boolean().optional().default(true),
  autoEnrollSources: z.array(z.string().min(1).max(60)).max(20).optional().default([]),
  workdaysOnly: z.boolean().optional().default(false),
  steps: z.array(stepSchema).optional().default([]),
})

export const GET = withRls(async (req: NextRequest, { orgId }) => {
  const { searchParams } = new URL(req.url)
  const isActive = searchParams.get("isActive")

  const sequences = await prisma.salesSequence.findMany({
    where: {
      organizationId: orgId as string,
      ...(isActive !== null ? { isActive: isActive === "true" } : {}),
    },
    include: {
      steps: {
        where: { isActive: true },
        orderBy: { stepOrder: "asc" },
      },
      _count: { select: { enrollments: true } },
    },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json({ success: true, data: sequences })
})

export const POST = withRlsAuth(undefined, undefined, async (req, auth) => {
  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const { name, description, isActive, exitOnReply, replyReaction, exitOnMeeting, exitOnDealClosed, autoEnrollSources, workdaysOnly, steps } = parsed.data
  const activeStepCount = steps.filter((step) => step.isActive !== false).length

  if ((isActive ?? true) && activeStepCount === 0) {
    return NextResponse.json(
      { error: "Add at least one active step before activating the sequence" },
      { status: 422 }
    )
  }

  const sequence = await prisma.salesSequence.create({
    data: {
      organizationId: auth.orgId,
      name,
      description,
      isActive: isActive ?? true,
      exitOnReply,
      replyReaction: replyReaction ?? null,
      exitOnMeeting,
      exitOnDealClosed,
      autoEnrollSources,
      workdaysOnly,
      createdBy: auth.userId,
      steps: steps.length > 0
        ? {
            create: steps.map((s) => ({
              organizationId: auth.orgId,
              ...s,
            })),
          }
        : undefined,
    },
    include: {
      steps: { orderBy: { stepOrder: "asc" } },
      _count: { select: { enrollments: true } },
    },
  })

  return NextResponse.json({ success: true, data: sequence }, { status: 201 })
})
