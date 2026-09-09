import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { buildContactWhere } from "@/lib/segment-conditions"

const createSegmentSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  conditions: z.any().optional(),
  contactCount: z.number().optional(),
  isDynamic: z.boolean().optional(),
})

export const GET = withRls(async (req, { orgId }) => {
  const { searchParams } = new URL(req.url)
  const search = searchParams.get("search") || ""
  const page = parseInt(searchParams.get("page") || "1")
  const limit = parseInt(searchParams.get("limit") || "50")

  try {
    const where = {
      organizationId: orgId,
      ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
    }

    const [segments, total] = await Promise.all([
      prisma.contactSegment.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.contactSegment.count({ where }),
    ])

    // Recalculate contactCount for dynamic segments
    const updated = await Promise.all(
      segments.map(async (seg: any) => {
        if (!seg.isDynamic) return seg

        const conditions = (seg.conditions && typeof seg.conditions === "object")
          ? seg.conditions as Record<string, any>
          : {}
        const contactWhere = buildContactWhere(orgId, conditions)
        const count = await prisma.contact.count({ where: contactWhere })

        // Update stored count if it changed (fire-and-forget)
        if (count !== seg.contactCount) {
          prisma.contactSegment.update({
            where: { id: seg.id },
            data: { contactCount: count },
          }).catch(() => {})
        }

        return { ...seg, contactCount: count }
      })
    )

    return NextResponse.json({
      success: true,
      data: { segments: updated, total, page, limit, search },
    })
  } catch (e) {
    console.error("[segments GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRls(async (req, { orgId }) => {
  const body = await req.json()
  const parsed = createSegmentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    const segment = await prisma.contactSegment.create({
      data: {
        organizationId: orgId,
        ...parsed.data,
      },
    })
    return NextResponse.json({ success: true, data: segment }, { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
