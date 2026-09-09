import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { z } from "zod"
import { STAGE_COLORS } from "@/lib/constants"

const createSchema = z.object({
  name: z.string().min(1).max(100),
  isDefault: z.boolean().optional(),
  stages: z.array(z.object({
    name: z.string().min(1),
    displayName: z.string().min(1),
    color: z.string().default(STAGE_COLORS.LEAD),
    probability: z.number().int().min(0).max(100).default(0),
    sortOrder: z.number().int().default(0),
    isWon: z.boolean().default(false),
    isLost: z.boolean().default(false),
  })).optional(),
})

export const GET = withRls(async (_req, { orgId }) => {
  const pipelines = await prisma.pipeline.findMany({
    where: { organizationId: orgId },
    include: {
      stages: { where: { isActive: true }, orderBy: { sortOrder: "asc" } },
      _count: { select: { deals: true } },
    },
    orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }],
  })

  return NextResponse.json({ success: true, data: pipelines })
})

export const POST = withRls(async (req, { orgId }) => {
  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation error", details: parsed.error.flatten() }, { status: 400 })
  }

  const { name, isDefault, stages } = parsed.data

  // If setting as default, unset others
  if (isDefault) {
    await prisma.pipeline.updateMany({
      where: { organizationId: orgId, isDefault: true },
      data: { isDefault: false },
    })
  }

  const pipeline = await prisma.pipeline.create({
    data: {
      organizationId: orgId,
      name,
      isDefault: isDefault || false,
      stages: stages ? {
        create: stages.map((s) => ({
          organizationId: orgId,
          ...s,
        })),
      } : undefined,
    },
    include: {
      stages: { orderBy: { sortOrder: "asc" } },
    },
  })

  return NextResponse.json({ success: true, data: pipeline }, { status: 201 })
})
