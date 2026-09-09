import { NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { withRls } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"

const updateReportSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional().nullable(),
  entityType: z.string().min(1).max(100).optional(),
  columns: z.any().optional(),
  filters: z.any().optional(),
  groupBy: z.string().max(100).optional().nullable(),
  sortBy: z.string().max(100).optional().nullable(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  chartType: z.string().max(50).optional(),
  chartConfig: z.any().optional().nullable(),
  isShared: z.boolean().optional(),
  scheduleFreq: z.string().max(50).optional().nullable(),
  scheduleEmails: z.array(z.string().email()).optional(),
})

export const GET = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const report = await prisma.savedReport.findFirst({
    where: { id, organizationId: orgId },
  })
  if (!report) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return NextResponse.json({ success: true, data: report })
})

export const PUT = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  let body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  let data
  try {
    data = updateReportSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const existing = await prisma.savedReport.findFirst({ where: { id, organizationId: orgId } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const report = await prisma.savedReport.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.entityType !== undefined && { entityType: data.entityType }),
      ...(data.columns !== undefined && { columns: data.columns }),
      ...(data.filters !== undefined && { filters: data.filters }),
      ...(data.groupBy !== undefined && { groupBy: data.groupBy }),
      ...(data.sortBy !== undefined && { sortBy: data.sortBy }),
      ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
      ...(data.chartType !== undefined && { chartType: data.chartType }),
      ...(data.chartConfig !== undefined && { chartConfig: data.chartConfig }),
      ...(data.isShared !== undefined && { isShared: data.isShared }),
      ...(data.scheduleFreq !== undefined && { scheduleFreq: data.scheduleFreq }),
      ...(data.scheduleEmails !== undefined && { scheduleEmails: data.scheduleEmails }),
      lastRunAt: new Date(),
    },
  })

  return NextResponse.json({ success: true, data: report })
})

export const DELETE = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const existing = await prisma.savedReport.findFirst({ where: { id, organizationId: orgId } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await prisma.savedReport.delete({ where: { id } })
  return NextResponse.json({ success: true, data: { deleted: true } })
})
