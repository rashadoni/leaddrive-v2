/**
 * CLM Slice 1b — Clause Library list + create.
 *
 * GET  /api/v1/contract-clauses  — org-scoped list; filter by category, status, riskLevel
 * POST /api/v1/contract-clauses  — create a new clause (version starts at 1)
 *
 * Auth (FIX 3): requireAuth(contracts, read/write) replaces getOrgId-only.
 * Status gate: setting status to "approved" or "retired" requires admin/superadmin.
 * Members/writers may only create clauses with status="draft".
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

// ─── Zod schema ──────────────────────────────────────────────────────────────

const createClauseSchema = z.object({
  title: z.string().min(1).max(255),
  body: z.string().min(1),
  category: z.string().max(100).optional(),
  riskLevel: z.enum(["standard", "fallback", "high_risk"]).default("standard"),
  governingLaw: z.string().max(255).optional(),
  fallbackOfClauseId: z.string().optional(),
  ownerUserId: z.string().optional(),
  status: z.enum(["draft", "approved", "retired"]).default("draft"),
})

// ─── GET /api/v1/contract-clauses ───────────────────────────────────────────

export const GET = withRlsAuth("contracts", "read", async (req, auth) => {
  // FIX 3: requireAuth (read) — replaces getOrgId-only; enforces RBAC + module gate.
  const { orgId } = auth

  const { searchParams } = new URL(req.url)
  const search = searchParams.get("search") || ""
  const category = searchParams.get("category")
  const status = searchParams.get("status")
  const riskLevel = searchParams.get("riskLevel")
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"))
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50")))

  try {
    const where = {
      organizationId: orgId,
      ...(search ? { title: { contains: search, mode: "insensitive" as const } } : {}),
      ...(category ? { category } : {}),
      ...(status ? { status } : {}),
      ...(riskLevel ? { riskLevel } : {}),
    }

    const [clauses, total] = await Promise.all([
      prisma.contractClause.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          organizationId: true,
          title: true,
          body: true,
          category: true,
          riskLevel: true,
          governingLaw: true,
          fallbackOfClauseId: true,
          ownerUserId: true,
          status: true,
          version: true,
          createdBy: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.contractClause.count({ where }),
    ])

    return NextResponse.json({ success: true, data: { clauses, total, page, limit } })
  } catch (e) {
    console.error("[contract-clauses GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

// ─── POST /api/v1/contract-clauses ──────────────────────────────────────────

export const POST = withRlsAuth("contracts", "write", async (req, auth) => {
  // FIX 3: requireAuth (write) — replaces getOrgId-only; enforces RBAC + module gate.
  const { orgId, userId, role } = auth

  const body = await req.json()
  const parsed = createClauseSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  // FIX 3: Status gate — only admin/superadmin may set approved or retired.
  // Non-admin writers may only create clauses in status="draft".
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

    const clause = await prisma.contractClause.create({
      data: {
        organizationId: orgId,
        ...parsed.data,
        version: 1,
        createdBy: userId ?? undefined,
      },
    })

    return NextResponse.json({ success: true, data: clause }, { status: 201 })
  } catch (e) {
    console.error("[contract-clauses POST]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
