import { NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { withRls } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"

const createReportSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  entityType: z.string().min(1).max(100),
  columns: z.any(),
  filters: z.any().default([]),
  groupBy: z.string().max(100).optional().nullable(),
  sortBy: z.string().max(100).optional().nullable(),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  chartType: z.string().max(50).default("table"),
  chartConfig: z.any().optional().nullable(),
  isShared: z.boolean().default(false),
  scheduleFreq: z.string().max(50).optional().nullable(),
  scheduleEmails: z.array(z.string().email()).default([]),
})

export const GET = withRls(async (req, { orgId }) => {
  const url = new URL(req.url)
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"))
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "20")))
  const skip = (page - 1) * limit

  const [reports, total] = await Promise.all([
    prisma.savedReport.findMany({
      where: { organizationId: orgId },
      orderBy: { updatedAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.savedReport.count({ where: { organizationId: orgId } }),
  ])

  return NextResponse.json({
    success: true,
    data: reports,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  })
})

export const POST = withRls(async (req, { orgId, session }) => {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  let body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  // Normalize: frontend sends { name, config: { entity, columns, ... }, scheduleFreq, scheduleEmails }
  // API expects flat { name, entityType, columns, ... }
  if (body.config && typeof body.config === "object") {
    const cfg = body.config
    body.entityType = body.entityType || cfg.entityType || cfg.entity
    body.columns = body.columns || cfg.columns
    body.filters = body.filters || cfg.filters
    body.groupBy = body.groupBy || cfg.groupBy || null
    body.sortBy = body.sortBy || cfg.sortBy || null
    body.sortOrder = body.sortOrder || cfg.sortOrder || "desc"
    body.chartType = body.chartType || cfg.chartType || "table"
  }
  // Accept "entity" as alias for "entityType"
  if (!body.entityType && body.entity) body.entityType = body.entity

  // Handle update (if id provided, use PUT logic)
  if (body.id) {
    const updateData: any = {}
    if (body.name) updateData.name = body.name
    if (body.entityType) updateData.entityType = body.entityType
    if (body.columns) updateData.columns = body.columns
    if (body.filters) updateData.filters = body.filters
    if (body.groupBy !== undefined) updateData.groupBy = body.groupBy || null
    if (body.sortBy !== undefined) updateData.sortBy = body.sortBy || null
    if (body.sortOrder) updateData.sortOrder = body.sortOrder
    if (body.chartType) updateData.chartType = body.chartType
    if (body.scheduleFreq !== undefined) updateData.scheduleFreq = body.scheduleFreq || null
    if (body.scheduleEmails) updateData.scheduleEmails = body.scheduleEmails

    const updated = await prisma.savedReport.updateMany({
      where: { id: body.id, organizationId: orgId },
      data: updateData,
    })
    if (updated.count === 0) return NextResponse.json({ error: "Report not found" }, { status: 404 })
    const report = await prisma.savedReport.findUnique({ where: { id: body.id } })
    return NextResponse.json(report)
  }

  let data
  try {
    data = createReportSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const report = await prisma.savedReport.create({
    data: {
      organizationId: orgId,
      createdBy: session.userId,
      name: data.name,
      description: data.description ?? null,
      entityType: data.entityType,
      columns: data.columns,
      filters: data.filters,
      groupBy: data.groupBy ?? null,
      sortBy: data.sortBy ?? null,
      sortOrder: data.sortOrder,
      chartType: data.chartType,
      chartConfig: data.chartConfig ?? undefined,
      isShared: data.isShared,
      scheduleFreq: data.scheduleFreq ?? null,
      scheduleEmails: data.scheduleEmails,
    },
  })

  return NextResponse.json({ success: true, data: report }, { status: 201 })
})
