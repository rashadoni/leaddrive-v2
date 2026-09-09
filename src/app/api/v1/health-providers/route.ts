/**
 * R2 Health — provider roster / create (slice-2-mini).
 *
 * Twelfth route-layer consumer of compliance-audit primitives.
 * Provider data isn't PHI by itself (public NPI registry) but every
 * access still rides on HIPAA's "treat the provider as part of the
 * patient context" audit posture — the same operator who looks up
 * providers is also looking up patients.
 *
 * No status lifecycle — `isActive` boolean + role enum. Email
 * UNIQUE per tenant. NPI optional (US-only) but length-validated
 * by DB CHECK (8..32).
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordPhiAccessFromRequest } from "@/lib/audit/compliance-audit"
import { PROVIDER_ROLES } from "@/lib/health/types"
import {
  encryptForTenantBound,
  softDecryptForTenantBound,
} from "@/lib/crypto/tenant-pii-encryption"

const TABLE = "health_providers"
const MAX_PAGE_SIZE = 200
const MAX_NAME_LEN = 200
const MAX_GENERIC_LEN = 200

function trimOrNull(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  if (!t) return null
  return t.slice(0, max)
}

export const GET = withRlsAuth("health", "read", async (req: NextRequest, auth) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const limitRaw = searchParams.get("limit")
  const cursor = searchParams.get("cursor")
  const role = searchParams.get("role")
  const specialty = searchParams.get("specialty")
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
    specialty?: string
    departmentSlug?: string
    isActive?: boolean
    OR?: Array<Record<string, { contains: string; mode: "insensitive" }>>
  } = { organizationId: orgId }
  if (role) where.role = role
  if (specialty) where.specialty = specialty
  if (departmentSlug) where.departmentSlug = departmentSlug
  if (isActiveRaw === "true") where.isActive = true
  else if (isActiveRaw === "false") where.isActive = false
  // fullName encrypted — drop from substring search (slice-3 blind-
  // index plan). Search hits email + npiNumber only.
  if (search && search.length >= 2) {
    where.OR = [
      { email: { contains: search, mode: "insensitive" } },
      { npiNumber: { contains: search, mode: "insensitive" } },
    ]
  }

  try {
    const providers = await prisma.healthProvider.findMany({
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
        npiNumber: true,
        role: true,
        specialty: true,
        departmentSlug: true,
        isActive: true,
        createdAt: true,
      },
    })
    const hasMore = providers.length > limit
    const rawRows = hasMore ? providers.slice(0, limit) : providers
    // Soft-decrypt fullName for list response.
    const rows = rawRows.map(
      (p: { fullName: string } & Record<string, unknown>) => ({
        ...p,
        fullName: softDecryptForTenantBound(orgId, TABLE, "fullName", p.fullName),
      }),
    )
    const nextCursor = hasMore ? (rows[rows.length - 1].id as string) : null

    void recordPhiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: null,
      action: "read",
      metadata: {
        limit,
        cursor,
        role: role ?? null,
        specialty: specialty ?? null,
        departmentSlug: departmentSlug ?? null,
        isActive: isActiveRaw === "true" || isActiveRaw === "false"
          ? isActiveRaw
          : null,
        searchHit: search !== null && search.length >= 2,
        rowCount: rows.length,
      },
    })

    return NextResponse.json({ providers: rows, hasMore, nextCursor })
  } catch (err) {
    console.error("[health-providers] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load providers" },
      { status: 500 },
    )
  }
})

interface CreateBody {
  userId?: unknown
  fullName?: unknown
  email?: unknown
  phone?: unknown
  npiNumber?: unknown
  role?: unknown
  specialty?: unknown
  departmentSlug?: unknown
  isActive?: unknown
  metadata?: unknown
}

export const POST = withRlsAuth("health", "write", async (req: NextRequest, auth) => {
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

  let role: string = "physician"
  if (body.role !== undefined && body.role !== null) {
    if (
      typeof body.role !== "string" ||
      !(PROVIDER_ROLES as readonly string[]).includes(body.role)
    ) {
      return NextResponse.json(
        {
          error: `Invalid \`role\` — must be one of: ${PROVIDER_ROLES.join(", ")}`,
        },
        { status: 400 },
      )
    }
    role = body.role
  }

  // NPI optional. DB CHECK enforces 8..32 length; we pre-validate
  // for friendly error instead of relying on the DB exception.
  let npiNumber: string | null = null
  if (body.npiNumber !== undefined && body.npiNumber !== null) {
    if (typeof body.npiNumber !== "string") {
      return NextResponse.json(
        { error: "Invalid `npiNumber`" },
        { status: 400 },
      )
    }
    const trimmed = body.npiNumber.trim()
    if (trimmed.length < 8 || trimmed.length > 32) {
      return NextResponse.json(
        { error: "`npiNumber` must be 8-32 chars" },
        { status: 400 },
      )
    }
    npiNumber = trimmed
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
    const provider = await prisma.healthProvider.create({
      data: {
        organizationId: orgId,
        userId: trimOrNull(body.userId, 64),
        // Slice-2 PII column wrap: encrypt fullName before persisting.
        fullName: encryptForTenantBound(orgId, TABLE, "fullName", fullName),
        email,
        phone: trimOrNull(body.phone, 32),
        npiNumber,
        role,
        specialty: trimOrNull(body.specialty, MAX_GENERIC_LEN),
        departmentSlug: trimOrNull(body.departmentSlug, 64),
        isActive,
        metadata: (body.metadata ?? {}) as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        userId: true,
        fullName: true,
        email: true,
        npiNumber: true,
        role: true,
        specialty: true,
        departmentSlug: true,
        isActive: true,
        createdAt: true,
      },
    })

    void recordPhiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: provider.id,
      action: "write",
      metadata: {
        email: provider.email,
        role: provider.role,
        npiNumber: provider.npiNumber,
        specialty: provider.specialty,
      },
    })

    return NextResponse.json(
      {
        provider: {
          ...provider,
          fullName: softDecryptForTenantBound(orgId, TABLE, "fullName", provider.fullName),
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
        { error: "A provider with this `email` already exists" },
        { status: 409 },
      )
    }
    console.error("[health-providers] POST error:", err)
    return NextResponse.json(
      { error: "Failed to create provider" },
      { status: 500 },
    )
  }
})
