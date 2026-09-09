/**
 * R8 Public Sector — license roster / create (slice-2-mini).
 *
 * Ninth route-layer consumer of compliance-audit primitives. Public
 * licensing data is FOIA-recordable (e.g. liquor / food-service /
 * building-permit lookups by reporters) — every list/get/write is
 * audited via `recordFoiaAccessFromRequest`.
 *
 * Status lifecycle (slice-1 `transitionLicense` helper):
 *   applied → under_review → issued
 *   issued → expired | suspended | revoked
 *   suspended → issued (reinstated) | revoked
 *   denied — terminal side exit
 *
 * Citizen FK is optional — a business license can be held by a legal
 * entity that isn't a `Citizen` row. caseId optional link to parent
 * case (drives statutory deadline math). Both checked for tenant.
 *
 * Decimal-money discipline on `feeAmount` (Decimal(18,2), >= 0, ≤2dp).
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { recordFoiaAccessFromRequest } from "@/lib/audit/compliance-audit"
import { LICENSE_TYPES } from "@/lib/public-sector/types"
import { withRlsAuth } from "@/lib/with-rls"

const TABLE = "public_sector_licenses"
const MAX_PAGE_SIZE = 200

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
  const licenseType = searchParams.get("licenseType")
  const citizenId = searchParams.get("citizenId")
  const caseId = searchParams.get("caseId")
  const issuingOfficialId = searchParams.get("issuingOfficialId")
  const licenseNumberSearch = searchParams.get("licenseNumberSearch")

  const limit = (() => {
    if (!limitRaw) return 50
    const n = Number(limitRaw)
    if (!Number.isInteger(n) || n <= 0) return 50
    return Math.min(n, MAX_PAGE_SIZE)
  })()

  const where: {
    organizationId: string
    status?: string
    licenseType?: string
    citizenId?: string
    caseId?: string
    issuingOfficialId?: string
    licenseNumber?: { contains: string; mode: "insensitive" }
  } = { organizationId: orgId }
  if (status) where.status = status
  if (licenseType) where.licenseType = licenseType
  if (citizenId) where.citizenId = citizenId
  if (caseId) where.caseId = caseId
  if (issuingOfficialId) where.issuingOfficialId = issuingOfficialId
  // Min-length guard on substring search — 1-char `contains` would
  // scan the entire tenant index even with the `org_status_idx`. Keep
  // the bar at 2 chars: short enough for "1A", long enough to skip
  // pathological single-character probes.
  if (licenseNumberSearch && licenseNumberSearch.length >= 2) {
    where.licenseNumber = {
      contains: licenseNumberSearch,
      mode: "insensitive",
    }
  }

  try {
    const licenses = await prisma.publicSectorLicense.findMany({
      where,
      orderBy: [{ appliedAt: "desc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        licenseNumber: true,
        licenseType: true,
        status: true,
        citizenId: true,
        caseId: true,
        issuingOfficialId: true,
        appliedAt: true,
        issuedAt: true,
        expiresAt: true,
        feeAmount: true,
        feeCurrency: true,
        createdAt: true,
      },
    })
    const hasMore = licenses.length > limit
    const rows = hasMore ? licenses.slice(0, limit) : licenses
    const nextCursor = hasMore ? rows[rows.length - 1].id : null

    void recordFoiaAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: null,
      action: "read",
      metadata: {
        limit,
        cursor,
        status: status ?? null,
        licenseType: licenseType ?? null,
        citizenId: citizenId ?? null,
        caseId: caseId ?? null,
        issuingOfficialId: issuingOfficialId ?? null,
        searchHit:
          licenseNumberSearch !== null && licenseNumberSearch.length > 0,
        rowCount: rows.length,
      },
    })

    return NextResponse.json({ licenses: rows, hasMore, nextCursor })
  } catch (err) {
    console.error("[public-sector-licenses] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load licenses" },
      { status: 500 },
    )
  }
})

interface CreateBody {
  licenseNumber?: unknown
  licenseType?: unknown
  citizenId?: unknown
  caseId?: unknown
  feeAmount?: unknown
  feeCurrency?: unknown
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

  const licenseNumber = trimOrNull(body.licenseNumber, 64)
  if (!licenseNumber) {
    return NextResponse.json(
      { error: "`licenseNumber` is required" },
      { status: 400 },
    )
  }
  if (
    typeof body.licenseType !== "string" ||
    !(LICENSE_TYPES as readonly string[]).includes(body.licenseType)
  ) {
    return NextResponse.json(
      {
        error: `\`licenseType\` is required and must be one of: ${LICENSE_TYPES.join(", ")}`,
      },
      { status: 400 },
    )
  }
  const licenseType = body.licenseType

  const feeAmount = parseDecimal(body.feeAmount ?? 0)
  if (feeAmount === "invalid") {
    return NextResponse.json(
      { error: "Invalid `feeAmount` (non-negative, ≤ 2dp)" },
      { status: 400 },
    )
  }

  let feeCurrency: string = "USD"
  if (body.feeCurrency !== undefined && body.feeCurrency !== null) {
    if (typeof body.feeCurrency !== "string") {
      return NextResponse.json(
        { error: "`feeCurrency` must be a 3-letter ISO 4217 code" },
        { status: 400 },
      )
    }
    const upper = body.feeCurrency.toUpperCase()
    // Strict ISO 4217 shape: 3 uppercase letters. DB CHECK only
    // enforces length=3, so a garbage "123" / "€$£" would slip past
    // the schema; we reject at the route boundary.
    if (!/^[A-Z]{3}$/.test(upper)) {
      return NextResponse.json(
        { error: "`feeCurrency` must be a 3-letter ISO 4217 code" },
        { status: 400 },
      )
    }
    feeCurrency = upper
  }

  const citizenId = trimOrNull(body.citizenId, 64)
  const caseId = trimOrNull(body.caseId, 64)

  // Tenant pre-checks (parallel) — citizen + case optional.
  const [citizenCheck, caseCheck] = await Promise.all([
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
  // Cross-reference: if both supplied, caseId.citizenId should match.
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
    const license = await prisma.publicSectorLicense.create({
      data: {
        organizationId: orgId,
        licenseNumber,
        licenseType,
        citizenId,
        caseId,
        feeAmount: feeAmount ?? new Prisma.Decimal(0),
        feeCurrency,
        metadata: (body.metadata ?? {}) as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        licenseNumber: true,
        licenseType: true,
        status: true,
        citizenId: true,
        caseId: true,
        appliedAt: true,
        feeAmount: true,
        feeCurrency: true,
        createdAt: true,
      },
    })

    void recordFoiaAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: license.id,
      action: "write",
      metadata: {
        licenseNumber: license.licenseNumber,
        licenseType: license.licenseType,
        citizenId: license.citizenId,
        caseId: license.caseId,
      },
    })

    return NextResponse.json({ license }, { status: 201 })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") {
        return NextResponse.json(
          { error: "A license with this `licenseNumber` already exists" },
          { status: 409 },
        )
      }
      if (err.code === "P2003") {
        return NextResponse.json(
          { error: "Invalid foreign key (`citizenId` / `caseId`)" },
          { status: 400 },
        )
      }
    }
    console.error("[public-sector-licenses] POST error:", err)
    return NextResponse.json(
      { error: "Failed to create license" },
      { status: 500 },
    )
  }
})
