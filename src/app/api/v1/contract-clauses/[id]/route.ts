/**
 * CLM Slice 1b — Clause Library detail (GET / PUT / DELETE).
 *
 * GET    /api/v1/contract-clauses/:id — fetch one clause (org-scoped)
 * PUT    /api/v1/contract-clauses/:id — update + bump version
 * DELETE /api/v1/contract-clauses/:id — hard delete
 *
 * Auth (FIX 3): requireAuth(contracts, read/write/delete) replaces getOrgId-only.
 * Status gate on PUT: setting status to "approved" or "retired" requires admin/superadmin.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

// ─── Zod schema ──────────────────────────────────────────────────────────────

const updateClauseSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  body: z.string().min(1).optional(),
  category: z.string().max(100).optional(),
  riskLevel: z.enum(["standard", "fallback", "high_risk"]).optional(),
  governingLaw: z.string().max(255).optional().nullable(),
  fallbackOfClauseId: z.string().optional().nullable(),
  ownerUserId: z.string().optional().nullable(),
  status: z.enum(["draft", "approved", "retired"]).optional(),
})

// ─── GET /api/v1/contract-clauses/:id ───────────────────────────────────────

export const GET = withRlsAuth("contracts", "read", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  // FIX 3: requireAuth (read) — replaces resolveGuards/getOrgId-only.
  const { orgId } = auth
  const { id } = await params

  try {
    const clause = await prisma.contractClause.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!clause) return NextResponse.json({ error: "Not found" }, { status: 404 })

    return NextResponse.json({ success: true, data: clause })
  } catch (e) {
    console.error("[contract-clauses GET/:id]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

// ─── PUT /api/v1/contract-clauses/:id ───────────────────────────────────────

export const PUT = withRlsAuth("contracts", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  // FIX 3: requireAuth (write) — replaces resolveGuards/getOrgId-only.
  const { orgId, role } = auth
  const { id } = await params

  const body = await req.json()
  const parsed = updateClauseSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  // FIX 3: Status gate — only admin/superadmin may set approved or retired.
  const requestedStatus = parsed.data.status
  if (
    (requestedStatus === "approved" || requestedStatus === "retired") &&
    role !== "admin" && role !== "superadmin"
  ) {
    return NextResponse.json(
      { error: `Setting status "${requestedStatus}" requires admin role.` },
      { status: 403 },
    )
  }

  try {
    // Verify ownership
    const existing = await prisma.contractClause.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, version: true },
    })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

    // FIX 6 (LOW): validate cross-entity refs belong to same org when supplied.
    if (parsed.data.fallbackOfClauseId) {
      const fallback = await prisma.contractClause.findFirst({
        where: { id: parsed.data.fallbackOfClauseId, organizationId: orgId },
        select: { id: true },
      })
      if (!fallback) {
        return NextResponse.json({ error: "Fallback clause not found in this tenant" }, { status: 404 })
      }
    }
    if (parsed.data.ownerUserId) {
      const owner = await prisma.user.findFirst({
        where: { id: parsed.data.ownerUserId, organizationId: orgId },
        select: { id: true },
      })
      if (!owner) {
        return NextResponse.json({ error: "Owner user not found in this tenant" }, { status: 404 })
      }
    }

    // Guarded conditional update: only succeeds if version hasn't changed since we read it.
    // Prevents the read-version-N/write-version-N+1 lost-update race under concurrent PUTs.
    const result = await prisma.contractClause.updateMany({
      where: { id, organizationId: orgId, version: existing.version },
      data: {
        ...parsed.data,
        version: { increment: 1 },
      },
    })
    if (result.count === 0) {
      return NextResponse.json({ error: "Version conflict — reload and retry" }, { status: 409 })
    }

    // Re-fetch to return the updated row with the new version number.
    const updated = await prisma.contractClause.findFirst({
      where: { id, organizationId: orgId },
    })

    return NextResponse.json({ success: true, data: updated })
  } catch (e) {
    console.error("[contract-clauses PUT/:id]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

// ─── DELETE /api/v1/contract-clauses/:id ────────────────────────────────────

export const DELETE = withRlsAuth("contracts", "delete", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  // FIX 3: requireAuth (delete) — replaces resolveGuards/getOrgId-only.
  const { orgId } = auth
  const { id } = await params

  try {
    const deleted = await prisma.contractClause.deleteMany({
      where: { id, organizationId: orgId },
    })
    if (deleted.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("[contract-clauses DELETE/:id]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
