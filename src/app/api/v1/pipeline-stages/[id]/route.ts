import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

export const PATCH = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const stage = await prisma.pipelineStage.findFirst({
    where: { id, organizationId: orgId },
  })
  if (!stage) return NextResponse.json({ error: "Stage not found" }, { status: 404 })

  const body = await req.json()
  const updateData: any = {}
  if (body.displayName !== undefined) updateData.displayName = body.displayName
  if (body.name !== undefined) updateData.name = body.name
  if (body.color !== undefined) updateData.color = body.color
  if (body.probability !== undefined) updateData.probability = Math.max(0, Math.min(100, Number(body.probability)))
  if (body.sortOrder !== undefined) updateData.sortOrder = Number(body.sortOrder)
  if (body.isWon !== undefined) updateData.isWon = Boolean(body.isWon)
  if (body.isLost !== undefined) updateData.isLost = Boolean(body.isLost)
  if (body.isActive !== undefined) updateData.isActive = Boolean(body.isActive)

  const updated = await prisma.pipelineStage.update({
    where: { id },
    data: updateData,
  })

  return NextResponse.json({ success: true, data: updated })
})

export const DELETE = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const stage = await prisma.pipelineStage.findFirst({
    where: { id, organizationId: orgId },
    include: { _count: { select: { validationRules: true } } },
  })
  if (!stage) return NextResponse.json({ error: "Stage not found" }, { status: 404 })

  // Check if any deals are using this stage name
  if (stage.pipelineId) {
    const dealsInStage = await prisma.deal.count({
      where: { organizationId: orgId, pipelineId: stage.pipelineId, stage: stage.name },
    })
    if (dealsInStage > 0) {
      return NextResponse.json(
        { error: `Cannot delete stage with ${dealsInStage} active deals. Move deals first.`, dealCount: dealsInStage },
        { status: 400 }
      )
    }
  }

  // Delete rules first, then stage
  await prisma.stageValidationRule.deleteMany({ where: { pipelineStageId: id } })
  await prisma.pipelineStage.delete({ where: { id } })

  return NextResponse.json({ success: true })
})
