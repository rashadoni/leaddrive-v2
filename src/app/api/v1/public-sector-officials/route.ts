/**
 * R8 Public Sector — official roster / create (slice-2-mini).
 *
 * Eleventh route-layer consumer of compliance-audit primitives.
 * Officials are public-by-definition (no PHI) but every read/write is
 * FOIA-recordable (e.g. "who could have looked at my case?").
 *
 * No status lifecycle — just `isActive` boolean + role + authorityLevel.
 * `authorityLevel` underpins R8 case escalation gate (canTransitionCase
 * — PR #98) so admin must be careful with downgrades.
 *
 * Email UNIQUE per tenant — P2002 → 409. Soft FK to User via
 * `userId` (optional; matches their SSO login).
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordFoiaAccessFromRequest } from "@/lib/audit/compliance-audit"
import {
  OFFICIAL_ROLES,
  AUTHORITY_LEVELS,
} from "@/lib/public-sector/types"
import {
  encryptForTenantBound,
  softDecryptForTenantBound,
} from "@/lib/crypto/tenant-pii-encryption"

const TABLE = "public_sector_officials"
const MAX_PAGE_SIZE = 200
const MAX_NAME_LEN = 200
const MAX_GENERIC_LEN = 200

function trimOrNull(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  if (!t) return null
  return t.slice(0, max)
}

function strField(
  v: unknown,
  max: number,
): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== "string") return undefined
  const t = v.trim()
  if (!t) return null
  return t.slice(0, max)
}

export const GET = withRlsAuth("public-sector", "read", async (req: NextRequest, auth) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const limitRaw = searchParams.get("limit")
  const cursor = searchParams.get("cursor")
  const role = searchParams.get("role")
  const authorityLevel = searchParams.get("authorityLevel")
  const agencySlug = searchParams.get("agencySlug")
  const departmentSlug = searchParams.get("departmentSlug")
  const isActiveRaw = searchParams.get("isActive")
  const search = searchParams.get("search")

  const limit = (() => {
    if (!limitRaw) return 50
    const n = Number(limitRaw)
    if (!Number.isInteger(n) || n <= 0) return 50
    return Math.min(n, MAX_PAGE_SIZE)
  })()

  const where: {
    organizationId: string
    role?: string
    authorityLevel?: string
    agencySlug?: string
    departmentSlug?: string
    isActive?: boolean
    OR?: Array<Record<string, { contains: string; mode: "insensitive" }>>
  } = { organizationId: orgId }
  if (role) where.role = role
  if (authorityLevel) where.authorityLevel = authorityLevel
  if (agencySlug) where.agencySlug = agencySlug
  if (departmentSlug) where.departmentSlug = departmentSlug
  if (isActiveRaw !== null) {
    if (isActiveRaw === "true") where.isActive = true
    else if (isActiveRaw === "false") where.isActive = false
  }
  // fullName encrypted — drop from substring search (slice-3 blind-
  // index plan). Search hits email only.
  if (search && search.length >= 2) {
    where.OR = [
      { email: { contains: search, mode: "insensitive" } },
    ]
  }

  try {
    const officials = await prisma.publicSectorOfficial.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        userId: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        agencySlug: true,
        departmentSlug: true,
        authorityLevel: true,
        specialties: true,
        isActive: true,
        createdAt: true,
      },
    })
    const hasMore = officials.length > limit
    const rawRows = hasMore ? officials.slice(0, limit) : officials
    // Soft-decrypt fullName for list response.
    const rows = rawRows.map(
      (o: { fullName: string } & Record<string, unknown>) => ({
        ...o,
        fullName: softDecryptForTenantBound(orgId, TABLE, "fullName", o.fullName),
      }),
    )
    const nextCursor = hasMore ? (rows[rows.length - 1].id as string) : null

    void recordFoiaAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: null,
      action: "read",
      metadata: {
        limit,
        cursor,
        role: role ?? null,
        authorityLevel: authorityLevel ?? null,
        agencySlug: agencySlug ?? null,
        departmentSlug: departmentSlug ?? null,
        isActive: isActiveRaw === "true" || isActiveRaw === "false"
          ? isActiveRaw
          : null,
        searchHit: search !== null && search.length >= 2,
        rowCount: rows.length,
      },
    })

    return NextResponse.json({ officials: rows, hasMore, nextCursor })
  } catch (err) {
    console.error("[public-sector-officials] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load officials" },
      { status: 500 },
    )
  }
})

interface CreateBody {
  userId?: unknown
  fullName?: unknown
  email?: unknown
  phone?: unknown
  role?: unknown
  agencySlug?: unknown
  departmentSlug?: unknown
  authorityLevel?: unknown
  specialties?: unknown
  isActive?: unknown
  metadata?: unknown
}

function parseSpecialties(v: unknown): string[] | "invalid" {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v)) return "invalid"
  const out: string[] = []
  for (const item of v) {
    if (typeof item !== "string") return "invalid"
    const t = item.trim()
    if (!t) continue
    if (t.length > 64) return "invalid"
    out.push(t)
    if (out.length > 32) return "invalid"
  }
  return out
}

export const POST = withRlsAuth("public-sector", "write", async (req: NextRequest, auth) => {
  const orgId = auth.orgId

  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const fullName = trimOrNull(body.fullName, MAX_NAME_LEN)
  if (!fullName) {
    return NextResponse.json(
      { error: "`fullName` is required" },
      { status: 400 },
    )
  }
  const email = trimOrNull(body.email, MAX_GENERIC_LEN)
  if (!email) {
    return NextResponse.json(
      { error: "`email` is required" },
      { status: 400 },
    )
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: "Invalid `email`" },
      { status: 400 },
    )
  }
  const agencySlug = trimOrNull(body.agencySlug, 64)
  if (!agencySlug) {
    return NextResponse.json(
      { error: "`agencySlug` is required" },
      { status: 400 },
    )
  }

  let role: string = "caseworker"
  if (body.role !== undefined && body.role !== null) {
    if (
      typeof body.role !== "string" ||
      !(OFFICIAL_ROLES as readonly string[]).includes(body.role)
    ) {
      return NextResponse.json(
        {
          error: `Invalid \`role\` — must be one of: ${OFFICIAL_ROLES.join(", ")}`,
        },
        { status: 400 },
      )
    }
    role = body.role
  }

  let authorityLevel: string = "line"
  if (body.authorityLevel !== undefined && body.authorityLevel !== null) {
    if (
      typeof body.authorityLevel !== "string" ||
      !(AUTHORITY_LEVELS as readonly string[]).includes(body.authorityLevel)
    ) {
      return NextResponse.json(
        {
          error: `Invalid \`authorityLevel\` — must be one of: ${AUTHORITY_LEVELS.join(", ")}`,
        },
        { status: 400 },
      )
    }
    authorityLevel = body.authorityLevel
  }

  const specialties = parseSpecialties(body.specialties)
  if (specialties === "invalid") {
    return NextResponse.json(
      {
        error:
          "`specialties` must be an array of strings (max 32 items, max 64 chars each)",
      },
      { status: 400 },
    )
  }

  let isActive = true
  if (body.isActive !== undefined && body.isActive !== null) {
    if (typeof body.isActive !== "boolean") {
      return NextResponse.json(
        { error: "`isActive` must be boolean" },
        { status: 400 },
      )
    }
    isActive = body.isActive
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
    const official = await prisma.publicSectorOfficial.create({
      data: {
        organizationId: orgId,
        userId: trimOrNull(body.userId, 64),
        // Slice-2 PII column wrap: encrypt fullName at the route
        // boundary. Officials are internal users but fullName is
        // still PII; FOIA records-request could surface it.
        fullName: encryptForTenantBound(orgId, TABLE, "fullName", fullName),
        email,
        phone: trimOrNull(body.phone, 32),
        role,
        agencySlug,
        departmentSlug: trimOrNull(body.departmentSlug, 64),
        authorityLevel,
        specialties,
        isActive,
        metadata: (body.metadata ?? {}) as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        userId: true,
        fullName: true,
        email: true,
        role: true,
        agencySlug: true,
        authorityLevel: true,
        isActive: true,
        createdAt: true,
      },
    })

    void recordFoiaAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: official.id,
      action: "write",
      metadata: {
        email: official.email,
        role: official.role,
        agencySlug: official.agencySlug,
        authorityLevel: official.authorityLevel,
      },
    })

    return NextResponse.json(
      {
        official: {
          ...official,
          fullName: softDecryptForTenantBound(orgId, TABLE, "fullName", official.fullName),
        },
      },
      { status: 201 },
    )
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "An official with this `email` already exists" },
        { status: 409 },
      )
    }
    console.error("[public-sector-officials] POST error:", err)
    return NextResponse.json(
      { error: "Failed to create official" },
      { status: 500 },
    )
  }
})
