/**
 * CLM Slice 4b-1 — ContractTag CRUD (item).
 *
 * PUT    /api/v1/contract-tags/:id  — rename and/or recolor a tag.
 * DELETE /api/v1/contract-tags/:id  — delete tag + cascade-remove all assignments.
 *
 * Auth: requireAuth — module gate ("contracts") + role-gated (write/delete).
 * Mirrors contracts CRUD hardening: PUT requires "write", DELETE requires "delete".
 */
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

const updateTagSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
})

export const PUT = withRlsAuth("contracts", "write", async (req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { orgId } = auth
  const { id } = await params

  const body = await req.json()
  const parsed = updateTagSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    const existing = await prisma.contractTag.findFirst({ where: { id, organizationId: orgId } })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const updated = await prisma.contractTag.update({
      where: { id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.color !== undefined ? { color: parsed.data.color } : {}),
      },
    })

    return NextResponse.json({ success: true, data: updated })
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === "P2002") {
      return NextResponse.json({ error: "A tag with this name already exists" }, { status: 409 })
    }
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRlsAuth("contracts", "delete", async (_req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { orgId } = auth
  const { id } = await params

  try {
    const existing = await prisma.contractTag.findFirst({ where: { id, organizationId: orgId } })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

    // Prisma cascades assignments via _ContractToContractTag FK on delete.
    await prisma.contractTag.delete({ where: { id } })

    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
