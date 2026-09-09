import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

const createJourneySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  status: z.enum(["draft", "active", "paused", "completed"]).optional(),
  triggerType: z.string().optional(),
  triggerConditions: z.any().optional(),
  segmentId: z.string().nullable().optional(),
  // Goal tracking
  goalType: z.string().nullable().optional(),
  goalConditions: z.any().nullable().optional(),
  goalTarget: z.number().int().nullable().optional(),
  exitOnGoal: z.boolean().optional(),
  maxEnrollmentDays: z.number().int().nullable().optional(),
})

export const GET = withRlsAuth("journeys", "read", async (req, { orgId }) => {
  const { searchParams } = new URL(req.url)
  const search = searchParams.get("search") || ""
  const page = parseInt(searchParams.get("page") || "1")
  const limit = parseInt(searchParams.get("limit") || "50")

  try {
    const where = {
      organizationId: orgId,
      ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
    }

    const [journeys, total] = await Promise.all([
      prisma.journey.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        include: { steps: { orderBy: { stepOrder: "asc" } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.journey.count({ where }),
    ])

    return NextResponse.json({
      success: true,
      data: { journeys, total, page, limit, search },
    })
  } catch (e) {
    console.error("[journeys GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRlsAuth("journeys", "write", async (req, { orgId }) => {
  const body = await req.json()
  const parsed = createJourneySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    const journey = await prisma.journey.create({
      data: {
        organizationId: orgId,
        ...parsed.data,
      },
    })
    return NextResponse.json({ success: true, data: journey }, { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
