import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { DEFAULT_PIPELINE_STAGES, STAGE_COLORS } from "@/lib/constants"
import { withRls, withRlsAuth } from "@/lib/with-rls"

const stageSchema = z.object({
  name: z.string().min(1).max(50),
  displayName: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  probability: z.number().min(0).max(100).optional(),
  sortOrder: z.number().optional(),
  isWon: z.boolean().optional(),
  isLost: z.boolean().optional(),
  pipelineId: z.string().optional(),
})

export const GET = withRls(async (req: NextRequest, { orgId }) => {
  try {
    const pipelineId = req.nextUrl.searchParams.get("pipelineId")
    const where: any = { organizationId: orgId }
    if (pipelineId) where.pipelineId = pipelineId

    const stages = await prisma.pipelineStage.findMany({
      where,
      orderBy: { sortOrder: "asc" },
    })

    return NextResponse.json({ success: true, data: stages })
  } catch {
    // Fallback to default stages if DB not connected
    const defaultStages = DEFAULT_PIPELINE_STAGES.map((s, i) => ({
      id: String(i + 1),
      ...s,
      isWon: "isWon" in s ? s.isWon : false,
      isLost: "isLost" in s ? s.isLost : false,
      organizationId: orgId,
    }))
    return NextResponse.json({ success: true, data: defaultStages })
  }
})

export const POST = withRlsAuth("settings", "write", async (req, authResult) => {
  const orgId = authResult.orgId

  const body = await req.json()
  const parsed = stageSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    const stage = await prisma.pipelineStage.create({
      data: {
        organizationId: orgId,
        pipelineId: parsed.data.pipelineId || null,
        name: parsed.data.name,
        displayName: parsed.data.displayName,
        color: parsed.data.color || STAGE_COLORS.LEAD,
        probability: parsed.data.probability || 0,
        sortOrder: parsed.data.sortOrder || 0,
        isWon: parsed.data.isWon || false,
        isLost: parsed.data.isLost || false,
      },
    })

    return NextResponse.json({ success: true, data: stage }, { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
