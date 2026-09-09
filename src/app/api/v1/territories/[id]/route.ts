/**
 * GET    /api/v1/territories/[id]  — get territory detail
 * PATCH  /api/v1/territories/[id]  — update name/description/isActive/rules
 * DELETE /api/v1/territories/[id]  — delete territory (cascades memberships)
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { z } from "zod"

const patchSchema = z.object({
  name:        z.string().min(1).max(200).optional(),
  description: z.string().nullish(),
  isActive:    z.boolean().optional(),
  rules: z.object({
    countries:      z.array(z.string()).optional(),
    industries:     z.array(z.string()).optional(),
    companySizeMin: z.number().int().min(0).optional(),
    companySizeMax: z.number().int().min(0).optional(),
  }).optional(),
})

async function getTerritoryOrFail(orgId: string, id: string) {
  return prisma.territory.findFirst({
    where: { id, organizationId: orgId },
  })
}

export const GET = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const territory = await prisma.territory.findFirst({
    where: { id, organizationId: orgId as string },
    include: {
      members: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
    },
  })

  if (!territory) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ success: true, data: territory })
})

export const PATCH = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const existing = await getTerritoryOrFail(orgId as string, id)
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const data: Record<string, unknown> = {}
  if (parsed.data.name !== undefined) data.name = parsed.data.name
  if (parsed.data.description !== undefined) data.description = parsed.data.description
  if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive
  // rules is a full replacement — callers must send the complete rules object, not a partial patch
  if (parsed.data.rules !== undefined) data.rules = parsed.data.rules

  const updated = await prisma.territory.update({
    where: { id },
    data,
    include: {
      members: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
    },
  })

  return NextResponse.json({ success: true, data: updated })
})

export const DELETE = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const existing = await getTerritoryOrFail(orgId as string, id)
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await prisma.territory.delete({ where: { id } })
  return NextResponse.json({ success: true })
})
