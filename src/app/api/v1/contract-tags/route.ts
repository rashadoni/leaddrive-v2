/**
 * CLM Slice 4b-1 — ContractTag CRUD (collection).
 *
 * GET  /api/v1/contract-tags    — org-scoped list with contract count per tag.
 * POST /api/v1/contract-tags    — create a tag (name required, unique per org, optional color).
 *
 * Auth: requireAuth — module gate ("contracts") + role-gated (read/write).
 * Mirrors contracts CRUD hardening: GET requires "read", POST requires "write".
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import type { ContractTag } from "@prisma/client"
import { withRlsAuth } from "@/lib/with-rls"

const createTagSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
})

export const GET = withRlsAuth("contracts", "read", async (_req, auth) => {
  const { orgId } = auth

  try {
    const tags = await prisma.contractTag.findMany({
      where: { organizationId: orgId },
      orderBy: { name: "asc" },
      include: {
        _count: { select: { contracts: true } },
      },
    })

    // Map to response shape — explicit ContractTag type annotation to satisfy strict noImplicitAny
    const data = tags.map((tag: ContractTag & { _count: { contracts: number } }) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color,
      contractCount: tag._count.contracts,
      createdAt: tag.createdAt,
      updatedAt: tag.updatedAt,
    }))

    return NextResponse.json({ success: true, data })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRlsAuth("contracts", "write", async (req, auth) => {
  const { orgId } = auth

  const body = await req.json()
  const parsed = createTagSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    const tag = await prisma.contractTag.create({
      data: {
        organizationId: orgId,
        name: parsed.data.name,
        color: parsed.data.color,
      },
    })

    return NextResponse.json({ success: true, data: tag }, { status: 201 })
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === "P2002") {
      return NextResponse.json({ error: "A tag with this name already exists" }, { status: 409 })
    }
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
