/**
 * R8 Public Sector — case roster / create (slice-2-mini).
 *
 * Sixth route-layer consumer of the compliance-audit primitives.
 * Mirrors PR #95 R8 citizens (FOIA audit) — every case-data read /
 * write is a FOIA-able record (citizen can demand "who looked at my
 * case #X between dates Y..Z?").
 *
 * Status lifecycle (slice-1 `transitionCase` + slice-2
 * `canTransitionCase`):
 *   submitted → intake → assigned → in_progress
 *   in_progress → escalated → resolved | denied (supervisor-gated)
 *   (denied / withdrawn side exits, all terminal)
 *
 * Case → Citizen FK uses `onDelete: Restrict` (schema.prisma:8984) —
 * case history must survive citizen deletion (FOIA + civil-discovery
 * retention). Slice-2 archive job cleans up.
 *
 * PII encryption deferred — same column-by-column wrap plan as
 * citizens. Operators MUST NOT load real case data until the wrap
 * pass completes.
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordFoiaAccessFromRequest } from "@/lib/audit/compliance-audit"
import { createNotification } from "@/lib/notifications"
import { CASE_TYPES, CASE_PRIORITIES } from "@/lib/public-sector/types"
import { encryptForTenantBoundOrNull } from "@/lib/crypto/tenant-pii-encryption"

// Phase 7 slice-3 migration (2026-05-29): column-bound AAD on the
// free-text `description` column. Other PII (decisionRationale,
// withdrawalReason) are PATCH-only and live in `[id]/route.ts`.
const TABLE = "public_sector_cases"
const MAX_PAGE_SIZE = 200
const MAX_GENERIC_LEN = 200
const MAX_SUBJECT_LEN = 500
const MAX_DESCRIPTION_LEN = 10_000

function strField(v: unknown, max: number = MAX_GENERIC_LEN): string | null {
  if (typeof v !== "string") return null
  const trimmed = v.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

function parseDate(v: unknown): Date | null | "invalid" {
  if (v === undefined || v === null) return null
  if (typeof v !== "string") return "invalid"
  const d = new Date(v)
  if (isNaN(d.getTime())) return "invalid"
  return d
}

export const GET = withRlsAuth("public-sector", "read", async (req, auth) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const limitRaw = searchParams.get("limit")
  const cursor = searchParams.get("cursor")
  const status = searchParams.get("status")
  const caseType = searchParams.get("caseType")
  const priority = searchParams.get("priority")
  const citizenId = searchParams.get("citizenId")
  const agencySlug = searchParams.get("agencySlug")
  const assignedOfficialId = searchParams.get("assignedOfficialId")
  const caseNumberSearch = searchParams.get("caseNumberSearch")

  const limit = (() => {
    if (!limitRaw) return 50
    const n = Number(limitRaw)
    if (!Number.isInteger(n) || n <= 0) return 50
    return Math.min(n, MAX_PAGE_SIZE)
  })()

  const where: {
    organizationId: string
    status?: string
    caseType?: string
    priority?: string
    citizenId?: string
    agencySlug?: string
    assignedOfficialId?: string
    caseNumber?: { contains: string; mode: "insensitive" }
  } = { organizationId: orgId }
  if (status) where.status = status
  if (caseType) where.caseType = caseType
  if (priority) where.priority = priority
  if (citizenId) where.citizenId = citizenId
  if (agencySlug) where.agencySlug = agencySlug
  if (assignedOfficialId) where.assignedOfficialId = assignedOfficialId
  if (caseNumberSearch && caseNumberSearch.length > 0) {
    where.caseNumber = { contains: caseNumberSearch, mode: "insensitive" }
  }

  try {
    const cases = await prisma.publicSectorCase.findMany({
      where,
      orderBy: [{ submittedAt: "desc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        caseNumber: true,
        citizenId: true,
        caseType: true,
        status: true,
        priority: true,
        agencySlug: true,
        departmentSlug: true,
        assignedOfficialId: true,
        subject: true,
        statutoryDueAt: true,
        submittedAt: true,
        resolvedAt: true,
        deniedAt: true,
        withdrawnAt: true,
        createdAt: true,
      },
    })
    const hasMore = cases.length > limit
    const rows = hasMore ? cases.slice(0, limit) : cases
    const nextCursor = hasMore ? rows[rows.length - 1].id : null

    void recordFoiaAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: null,
      action: "read",
      metadata: {
        limit,
        cursor,
        status: status ?? null,
        caseType: caseType ?? null,
        priority: priority ?? null,
        citizenId: citizenId ?? null,
        agencySlug: agencySlug ?? null,
        assignedOfficialId: assignedOfficialId ?? null,
        searchHit: caseNumberSearch !== null && caseNumberSearch.length > 0,
        rowCount: rows.length,
      },
    })

    return NextResponse.json({ cases: rows, hasMore, nextCursor })
  } catch (err) {
    console.error("[public-sector-cases] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load cases" },
      { status: 500 },
    )
  }
})

interface CreateBody {
  caseNumber?: unknown
  citizenId?: unknown
  caseType?: unknown
  priority?: unknown
  agencySlug?: unknown
  departmentSlug?: unknown
  subject?: unknown
  description?: unknown
  statutoryDueAt?: unknown
}

export const POST = withRlsAuth("public-sector", "write", async (req, auth) => {
  const orgId = auth.orgId

  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const caseNumber = strField(body.caseNumber, 64)
  if (!caseNumber) {
    return NextResponse.json(
      { error: "`caseNumber` is required" },
      { status: 400 },
    )
  }
  const citizenId = strField(body.citizenId, 64)
  if (!citizenId) {
    return NextResponse.json(
      { error: "`citizenId` is required" },
      { status: 400 },
    )
  }
  if (
    typeof body.caseType !== "string" ||
    !(CASE_TYPES as readonly string[]).includes(body.caseType)
  ) {
    return NextResponse.json(
      {
        error: `\`caseType\` is required and must be one of: ${CASE_TYPES.join(", ")}`,
      },
      { status: 400 },
    )
  }
  const caseType = body.caseType
  const agencySlug = strField(body.agencySlug, 64)
  if (!agencySlug) {
    return NextResponse.json(
      { error: "`agencySlug` is required" },
      { status: 400 },
    )
  }
  const subject = strField(body.subject, MAX_SUBJECT_LEN)
  if (!subject) {
    return NextResponse.json(
      { error: "`subject` is required" },
      { status: 400 },
    )
  }

  let priority: string = "routine"
  if (body.priority !== undefined && body.priority !== null) {
    if (
      typeof body.priority !== "string" ||
      !(CASE_PRIORITIES as readonly string[]).includes(body.priority)
    ) {
      return NextResponse.json(
        {
          error: `Invalid \`priority\` — must be one of: ${CASE_PRIORITIES.join(", ")}`,
        },
        { status: 400 },
      )
    }
    priority = body.priority
  }

  const statutoryDueAt = parseDate(body.statutoryDueAt)
  if (statutoryDueAt === "invalid") {
    return NextResponse.json(
      { error: "Invalid `statutoryDueAt`" },
      { status: 400 },
    )
  }

  // Tenant pre-check on citizen.
  const citizenCheck = await prisma.citizen.findFirst({
    where: { id: citizenId, organizationId: orgId },
    select: { id: true },
  })
  if (!citizenCheck) {
    return NextResponse.json(
      { error: "Citizen not found for this tenant" },
      { status: 404 },
    )
  }

  try {
    const caseRow = await prisma.publicSectorCase.create({
      data: {
        organizationId: orgId,
        caseNumber,
        citizenId,
        caseType,
        priority,
        agencySlug,
        departmentSlug: strField(body.departmentSlug, 64),
        subject,
        // Slice-2 PII column wrap: case `description` may contain
        // citizen complaint details / address fragments / medical
        // information — encrypt at the route boundary.
        description: encryptForTenantBoundOrNull(
          orgId,
          TABLE,
          "description",
          strField(body.description, MAX_DESCRIPTION_LEN),
        ),
        statutoryDueAt,
      },
      select: {
        id: true,
        caseNumber: true,
        citizenId: true,
        caseType: true,
        status: true,
        priority: true,
        agencySlug: true,
        departmentSlug: true,
        subject: true,
        statutoryDueAt: true,
        submittedAt: true,
        createdAt: true,
      },
    })

    void recordFoiaAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: caseRow.id,
      action: "write",
      metadata: {
        caseNumber: caseRow.caseNumber,
        citizenId: caseRow.citizenId,
        caseType: caseRow.caseType,
        agencySlug: caseRow.agencySlug,
        priority: caseRow.priority,
      },
    })

    // Phase 2d notification — org-wide in-app only, PII-safe (no citizen data in title/message).
    createNotification({
      organizationId: orgId,
      userId: "",
      type: "info",
      title: "New case opened",
      message: "A new public sector case has been opened",
      entityType: "ps_case",
      entityId: caseRow.id,
      kind: "ps_case.created",
    }).catch(() => {})

    return NextResponse.json({ case: caseRow }, { status: 201 })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") {
        return NextResponse.json(
          { error: "A case with this `caseNumber` already exists" },
          { status: 409 },
        )
      }
      if (err.code === "P2003") {
        return NextResponse.json(
          { error: "Invalid foreign key (`citizenId`)" },
          { status: 400 },
        )
      }
    }
    console.error("[public-sector-cases] POST error:", err)
    return NextResponse.json(
      { error: "Failed to create case" },
      { status: 500 },
    )
  }
})
