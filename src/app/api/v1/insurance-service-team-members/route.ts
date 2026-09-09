/**
 * R7 Insurance — service team member roster / create (slice-2-mini).
 *
 * Fourteenth route-layer consumer. Mirrors R8 officials pattern —
 * service-team members are referenced by policies (underwriter) and
 * claims (adjuster); deletion would break FK trail. Use isActive
 * for retirement.
 *
 * SERVICE_TEAM_ROLES allow-list governs `canTransitionClaim` SIU
 * audit-trail rule indirectly: an `senior_adjuster` is the typical
 * approver for un-approve reversal. linesSpecialty drives policy
 * underwriting routing.
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordPiiAccessFromRequest } from "@/lib/audit/compliance-audit"
import {
  SERVICE_TEAM_ROLES,
  LINES_OF_BUSINESS,
} from "@/lib/insurance/types"
import {
  encryptForTenantBound,
  softDecryptForTenantBound,
} from "@/lib/crypto/tenant-pii-encryption"

const TABLE = "insurance_service_team_members"
const MAX_PAGE_SIZE = 200
const MAX_NAME_LEN = 200
const MAX_GENERIC_LEN = 200

function trimOrNull(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  if (!t) return null
  return t.slice(0, max)
}

function parseStringArray(
  v: unknown,
  allowList: readonly string[] | null,
  maxItems: number,
  maxItemLen: number,
): string[] | "invalid" {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v)) return "invalid"
  const out: string[] = []
  for (const item of v) {
    if (typeof item !== "string") return "invalid"
    const t = item.trim()
    if (!t) continue
    if (t.length > maxItemLen) return "invalid"
    if (allowList && !allowList.includes(t)) return "invalid"
    out.push(t)
    if (out.length > maxItems) return "invalid"
  }
  return out
}

export const GET = withRlsAuth("insurance", "read", async (req: NextRequest, auth) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const limitRaw = searchParams.get("limit")
  const cursor = searchParams.get("cursor")
  const role = searchParams.get("role")
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
    isActive?: boolean
    OR?: Array<Record<string, { contains: string; mode: "insensitive" }>>
  } = { organizationId: orgId }
  if (role) where.role = role
  if (isActiveRaw === "true") where.isActive = true
  else if (isActiveRaw === "false") where.isActive = false
  // fullName encrypted — drop from substring search (slice-3 blind-
  // index plan). Search hits email + licenseNumber only.
  if (search && search.length >= 2) {
    where.OR = [
      { email: { contains: search, mode: "insensitive" } },
      { licenseNumber: { contains: search, mode: "insensitive" } },
    ]
  }

  try {
    const members = await prisma.insuranceServiceTeamMember.findMany({
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
        licenseNumber: true,
        licensedRegions: true,
        linesSpecialty: true,
        isActive: true,
        createdAt: true,
      },
    })
    const hasMore = members.length > limit
    const rawRows = hasMore ? members.slice(0, limit) : members
    // Soft-decrypt fullName for list response.
    const rows = rawRows.map(
      (m: { fullName: string } & Record<string, unknown>) => ({
        ...m,
        fullName: softDecryptForTenantBound(orgId, TABLE, "fullName", m.fullName),
      }),
    )
    const nextCursor = hasMore ? (rows[rows.length - 1].id as string) : null

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: null,
      action: "read",
      metadata: {
        limit,
        cursor,
        role: role ?? null,
        isActive: isActiveRaw === "true" || isActiveRaw === "false"
          ? isActiveRaw
          : null,
        searchHit: search !== null && search.length >= 2,
        rowCount: rows.length,
      },
    })

    return NextResponse.json({ members: rows, hasMore, nextCursor })
  } catch (err) {
    console.error("[insurance-service-team-members] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load service team members" },
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
  licenseNumber?: unknown
  licensedRegions?: unknown
  linesSpecialty?: unknown
  isActive?: unknown
  metadata?: unknown
}

export const POST = withRlsAuth("insurance", "write", async (req: NextRequest, auth) => {
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
    return NextResponse.json({ error: "Invalid `email`" }, { status: 400 })
  }
  if (
    typeof body.role !== "string" ||
    !(SERVICE_TEAM_ROLES as readonly string[]).includes(body.role)
  ) {
    return NextResponse.json(
      {
        error: `\`role\` is required and must be one of: ${SERVICE_TEAM_ROLES.join(", ")}`,
      },
      { status: 400 },
    )
  }
  const role = body.role

  const licensedRegions = parseStringArray(
    body.licensedRegions,
    null,
    16,
    32,
  )
  if (licensedRegions === "invalid") {
    return NextResponse.json(
      {
        error:
          "`licensedRegions` must be an array of strings (max 16 items, max 32 chars each)",
      },
      { status: 400 },
    )
  }
  const linesSpecialty = parseStringArray(
    body.linesSpecialty,
    LINES_OF_BUSINESS,
    LINES_OF_BUSINESS.length,
    32,
  )
  if (linesSpecialty === "invalid") {
    return NextResponse.json(
      {
        error: `\`linesSpecialty\` must be an array of strings from: ${LINES_OF_BUSINESS.join(", ")}`,
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
    const member = await prisma.insuranceServiceTeamMember.create({
      data: {
        organizationId: orgId,
        userId: trimOrNull(body.userId, 64),
        // Slice-2 PII column wrap: encrypt fullName before persisting.
        fullName: encryptForTenantBound(orgId, TABLE, "fullName", fullName),
        email,
        phone: trimOrNull(body.phone, 32),
        role,
        licenseNumber: trimOrNull(body.licenseNumber, 64),
        licensedRegions,
        linesSpecialty,
        isActive,
        metadata: (body.metadata ?? {}) as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        userId: true,
        fullName: true,
        email: true,
        role: true,
        licenseNumber: true,
        isActive: true,
        createdAt: true,
      },
    })

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: member.id,
      action: "write",
      metadata: {
        email: member.email,
        role: member.role,
        licenseNumber: member.licenseNumber,
      },
    })

    return NextResponse.json(
      {
        member: {
          ...member,
          fullName: softDecryptForTenantBound(orgId, TABLE, "fullName", member.fullName),
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
        { error: "A service team member with this `email` already exists" },
        { status: 409 },
      )
    }
    console.error("[insurance-service-team-members] POST error:", err)
    return NextResponse.json(
      { error: "Failed to create service team member" },
      { status: 500 },
    )
  }
})
