/**
 * R8 Public Sector — grant roster / create (slice-2-mini).
 *
 * Tenth route-layer consumer of compliance-audit primitives. Grant
 * data is FOIA-recordable; disbursement amounts are Decimal(18,2).
 *
 * Status lifecycle (slice-1 `transitionGrant` helper):
 *   submitted → under_review → approved → disbursing → disbursed
 *   submitted → withdrawn (terminal)
 *   under_review → denied | withdrawn
 *   approved → cancelled
 *   disbursing → cancelled
 *
 * Notable coherence constraints (DB CHECK):
 *   • approved/disbursing/disbursed/cancelled → approvedAmount NOT NULL
 *   • disbursed → disbursedAmount = approvedAmount (full disbursement)
 *   • denied → decisionRationale; withdrawn/cancelled → terminationReason
 *   • disbursedAmount ≤ approvedAmount always
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordFoiaAccessFromRequest } from "@/lib/audit/compliance-audit"
import { encryptForTenantBoundOrNull } from "@/lib/crypto/tenant-pii-encryption"

// Phase 7 slice-3 migration (2026-05-29): column-bound AAD on the
// free-text `narrative` column (PII — applicant story). Other PII
// (decisionRationale, terminationReason) are PATCH-only and live in
// `[id]/route.ts`. AAD binds to (orgId, public_sector_grants,
// "<column>") to defeat same-tenant cross-column ciphertext shuffle.
const TABLE = "public_sector_grants"
const MAX_PAGE_SIZE = 200
const MAX_NARRATIVE_LEN = 20_000

function trimOrNull(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  if (!t) return null
  return t.slice(0, max)
}

function parseDecimal(
  v: unknown,
  allowNegative = false,
): Prisma.Decimal | null | "invalid" {
  if (v === undefined || v === null) return null
  let raw: string
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "invalid"
    raw = String(v)
  } else if (typeof v === "string") {
    raw = v.trim()
    if (!/^-?\d+(\.\d+)?$/.test(raw)) return "invalid"
  } else {
    return "invalid"
  }
  const dot = raw.indexOf(".")
  if (dot !== -1 && raw.length - dot - 1 > 2) return "invalid"
  try {
    const d = new Prisma.Decimal(raw)
    if (!allowNegative && d.isNegative()) return "invalid"
    return d
  } catch {
    return "invalid"
  }
}

export const GET = withRlsAuth("public-sector", "read", async (req, auth) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const limitRaw = searchParams.get("limit")
  const cursor = searchParams.get("cursor")
  const status = searchParams.get("status")
  const programSlug = searchParams.get("programSlug")
  const citizenId = searchParams.get("citizenId")
  const caseId = searchParams.get("caseId")
  const assignedOfficialId = searchParams.get("assignedOfficialId")
  const grantNumberSearch = searchParams.get("grantNumberSearch")

  const limit = (() => {
    if (!limitRaw) return 50
    const n = Number(limitRaw)
    if (!Number.isInteger(n) || n <= 0) return 50
    return Math.min(n, MAX_PAGE_SIZE)
  })()

  const where: {
    organizationId: string
    status?: string
    programSlug?: string
    citizenId?: string
    caseId?: string
    assignedOfficialId?: string
    grantNumber?: { contains: string; mode: "insensitive" }
  } = { organizationId: orgId }
  if (status) where.status = status
  if (programSlug) where.programSlug = programSlug
  if (citizenId) where.citizenId = citizenId
  if (caseId) where.caseId = caseId
  if (assignedOfficialId) where.assignedOfficialId = assignedOfficialId
  if (grantNumberSearch && grantNumberSearch.length >= 2) {
    where.grantNumber = {
      contains: grantNumberSearch,
      mode: "insensitive",
    }
  }

  try {
    const grants = await prisma.publicSectorGrant.findMany({
      where,
      orderBy: [{ submittedAt: "desc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        grantNumber: true,
        programSlug: true,
        status: true,
        citizenId: true,
        caseId: true,
        assignedOfficialId: true,
        requestedAmount: true,
        approvedAmount: true,
        disbursedAmount: true,
        currency: true,
        submittedAt: true,
        approvedAt: true,
        disbursedAt: true,
        createdAt: true,
      },
    })
    const hasMore = grants.length > limit
    const rows = hasMore ? grants.slice(0, limit) : grants
    const nextCursor = hasMore ? rows[rows.length - 1].id : null

    void recordFoiaAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: null,
      action: "read",
      metadata: {
        limit,
        cursor,
        status: status ?? null,
        programSlug: programSlug ?? null,
        citizenId: citizenId ?? null,
        caseId: caseId ?? null,
        assignedOfficialId: assignedOfficialId ?? null,
        searchHit:
          grantNumberSearch !== null && grantNumberSearch.length >= 2,
        rowCount: rows.length,
      },
    })

    return NextResponse.json({ grants: rows, hasMore, nextCursor })
  } catch (err) {
    console.error("[public-sector-grants] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load grants" },
      { status: 500 },
    )
  }
})

interface CreateBody {
  grantNumber?: unknown
  programSlug?: unknown
  citizenId?: unknown
  caseId?: unknown
  requestedAmount?: unknown
  currency?: unknown
  assignedOfficialId?: unknown
  narrative?: unknown
  metadata?: unknown
}

export const POST = withRlsAuth("public-sector", "write", async (req, auth) => {
  const orgId = auth.orgId

  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const grantNumber = trimOrNull(body.grantNumber, 64)
  if (!grantNumber) {
    return NextResponse.json(
      { error: "`grantNumber` is required" },
      { status: 400 },
    )
  }
  const programSlug = trimOrNull(body.programSlug, 64)
  if (!programSlug) {
    return NextResponse.json(
      { error: "`programSlug` is required" },
      { status: 400 },
    )
  }

  const requestedAmount = parseDecimal(body.requestedAmount)
  if (requestedAmount === "invalid" || requestedAmount === null) {
    return NextResponse.json(
      { error: "`requestedAmount` is required (non-negative, ≤ 2dp)" },
      { status: 400 },
    )
  }

  let currency: string = "USD"
  if (body.currency !== undefined && body.currency !== null) {
    if (typeof body.currency !== "string") {
      return NextResponse.json(
        { error: "`currency` must be a 3-letter ISO 4217 code" },
        { status: 400 },
      )
    }
    const upper = body.currency.toUpperCase()
    if (!/^[A-Z]{3}$/.test(upper)) {
      return NextResponse.json(
        { error: "`currency` must be a 3-letter ISO 4217 code" },
        { status: 400 },
      )
    }
    currency = upper
  }

  const citizenId = trimOrNull(body.citizenId, 64)
  const caseId = trimOrNull(body.caseId, 64)
  const assignedOfficialId = trimOrNull(body.assignedOfficialId, 64)

  // Tenant pre-checks in parallel.
  const [citizenCheck, caseCheck, officialCheck] = await Promise.all([
    citizenId
      ? prisma.citizen.findFirst({
          where: { id: citizenId, organizationId: orgId },
          select: { id: true },
        })
      : Promise.resolve(null),
    caseId
      ? prisma.publicSectorCase.findFirst({
          where: { id: caseId, organizationId: orgId },
          select: { id: true, citizenId: true },
        })
      : Promise.resolve(null),
    assignedOfficialId
      ? prisma.publicSectorOfficial.findFirst({
          where: { id: assignedOfficialId, organizationId: orgId },
          select: { id: true },
        })
      : Promise.resolve(null),
  ])
  if (citizenId && !citizenCheck) {
    return NextResponse.json(
      { error: "Citizen not found for this tenant" },
      { status: 404 },
    )
  }
  if (caseId && !caseCheck) {
    return NextResponse.json(
      { error: "Case not found for this tenant" },
      { status: 404 },
    )
  }
  if (assignedOfficialId && !officialCheck) {
    return NextResponse.json(
      { error: "Official not found for this tenant" },
      { status: 404 },
    )
  }
  if (citizenId && caseCheck && caseCheck.citizenId !== citizenId) {
    return NextResponse.json(
      {
        error:
          "`caseId` references a different citizen than supplied `citizenId`",
      },
      { status: 400 },
    )
  }

  if (
    body.metadata !== undefined &&
    body.metadata !== null &&
    (typeof body.metadata !== "object" || Array.isArray(body.metadata))
  ) {
    return NextResponse.json(
      { error: "Invalid `metadata` — must be plain object" },
      { status: 400 },
    )
  }

  try {
    const grant = await prisma.publicSectorGrant.create({
      data: {
        organizationId: orgId,
        grantNumber,
        programSlug,
        citizenId,
        caseId,
        assignedOfficialId,
        requestedAmount,
        currency,
        // Slice-2 PII column wrap: narrative may contain hardship/
        // applicant details — encrypt at the route boundary.
        narrative: encryptForTenantBoundOrNull(
          orgId,
          TABLE,
          "narrative",
          trimOrNull(body.narrative, MAX_NARRATIVE_LEN),
        ),
        metadata: (body.metadata ?? {}) as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        grantNumber: true,
        programSlug: true,
        status: true,
        citizenId: true,
        caseId: true,
        assignedOfficialId: true,
        requestedAmount: true,
        currency: true,
        submittedAt: true,
        createdAt: true,
      },
    })

    void recordFoiaAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: grant.id,
      action: "write",
      metadata: {
        grantNumber: grant.grantNumber,
        programSlug: grant.programSlug,
        citizenId: grant.citizenId,
        caseId: grant.caseId,
      },
    })

    return NextResponse.json({ grant }, { status: 201 })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") {
        return NextResponse.json(
          { error: "A grant with this `grantNumber` already exists" },
          { status: 409 },
        )
      }
      if (err.code === "P2003") {
        return NextResponse.json(
          {
            error:
              "Invalid foreign key (`citizenId` / `caseId` / `assignedOfficialId`)",
          },
          { status: 400 },
        )
      }
    }
    console.error("[public-sector-grants] POST error:", err)
    return NextResponse.json(
      { error: "Failed to create grant" },
      { status: 500 },
    )
  }
})
