/**
 * GET  /api/v1/territories  — list all territories for the org
 * POST /api/v1/territories  — create a new territory
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls, withRlsAuth } from "@/lib/with-rls"
import { z } from "zod"

const rulesSchema = z.object({
  countries:      z.array(z.string()).optional(),
  industries:     z.array(z.string()).optional(),
  companySizeMin: z.number().int().min(0).optional(),
  companySizeMax: z.number().int().min(0).optional(),
})

const createSchema = z.object({
  name:        z.string().min(1).max(200),
  description: z.string().nullish(),
  isActive:    z.boolean().optional().default(true),
  rules:       rulesSchema.optional(),
})

export const GET = withRls(async (req: NextRequest, { orgId }) => {
  const { searchParams } = new URL(req.url)
  const isActiveParam = searchParams.get("isActive")

  const territories = await prisma.territory.findMany({
    where: {
      organizationId: orgId as string,
      ...(isActiveParam !== null ? { isActive: isActiveParam === "true" } : {}),
    },
    include: {
      members: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
    },
    orderBy: { name: "asc" },
  })

  return NextResponse.json({ success: true, data: territories })
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

  const { name, description, isActive, rules } = parsed.data

  const territory = await prisma.territory.create({
    data: {
      organizationId: auth.orgId,
      name,
      description: description ?? undefined,
      isActive: isActive ?? true,
      rules,
    },
    include: {
      members: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
    },
  })

  return NextResponse.json({ success: true, data: territory }, { status: 201 })
})
