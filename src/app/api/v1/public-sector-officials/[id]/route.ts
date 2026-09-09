/**
 * R8 Public Sector — official per-id (slice-2-mini).
 *
 * GET — single read + 404 audit.
 * PATCH — mutable fields + role / authorityLevel reassignment.
 *
 * ⚠️ authorityLevel demotion guard: an official with assigned
 * `escalated` cases at line authority would block the case-resolution
 * gate (PR #88 `canTransitionCase`). Demoting from supervisor/director
 * to line while assigned to such cases is technically legal here,
 * since the supervisor-gate fires at decision-time on `canTransitionCase`
 * — but a supervisor-shadow workflow would catch it. Slice-2 follow-up
 * adds a "no-orphan-escalation" pre-check.
 *
 * Immutable post-create (de-facto): email — UNIQUE per tenant, swap
 * would forge identity. Other fields all mutable.
 *
 * DELETE intentionally NOT exposed — officials are referenced by
 * historical cases / licenses / grants; deletion would break FK
 * audit-trail. Use `isActive=false` to retire.
 */
import { NextResponse } from "next/server"
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
const MAX_NAME_LEN = 200
const MAX_GENERIC_LEN = 200

function strField(v: unknown, max: number): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== "string") return undefined
  const t = v.trim()
  if (!t) return null
  return t.slice(0, max)
}

function parseSpecialties(v: unknown): string[] | "invalid" | undefined {
  if (v === undefined) return undefined
  if (v === null) return [] // explicit clear → empty array
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

export const GET = withRlsAuth("public-sector", "read", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json(
      { error: "Missing official id" },
      { status: 400 },
    )
  }

  try {
    const official = await prisma.publicSectorOfficial.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!official) {
      void recordFoiaAccessFromRequest(req, auth, {
        recordTable: TABLE,
        recordId: id,
        action: "read",
        metadata: { result: "not_found" },
      })
      return NextResponse.json(
        { error: "Official not found" },
        { status: 404 },
      )
    }

    void recordFoiaAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: official.id,
      action: "read",
      metadata: {
        email: official.email,
        role: official.role,
        agencySlug: official.agencySlug,
        authorityLevel: official.authorityLevel,
        isActive: official.isActive,
      },
    })

    return NextResponse.json({
      official: {
        ...official,
        fullName: softDecryptForTenantBound(orgId, TABLE, "fullName", official.fullName),
      },
    })
  } catch (err) {
    console.error("[public-sector-officials/:id] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load official" },
      { status: 500 },
    )
  }
})

interface PatchBody {
  userId?: unknown
  fullName?: unknown
  phone?: unknown
  role?: unknown
  agencySlug?: unknown
  departmentSlug?: unknown
  authorityLevel?: unknown
  specialties?: unknown
  isActive?: unknown
  metadata?: unknown
}

export const PATCH = withRlsAuth("public-sector", "write", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json(
      { error: "Missing official id" },
      { status: 400 },
    )
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const existing = await prisma.publicSectorOfficial.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  })
  if (!existing) {
    void recordFoiaAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: id,
      action: "write",
      metadata: { result: "not_found" },
    })
    return NextResponse.json(
      { error: "Official not found" },
      { status: 404 },
    )
  }

  const data: {
    userId?: string | null
    fullName?: string
    phone?: string | null
    role?: string
    agencySlug?: string
    departmentSlug?: string | null
    authorityLevel?: string
    specialties?: string[]
    isActive?: boolean
    metadata?: unknown
  } = {}

  if (body.userId !== undefined) {
    const v = strField(body.userId, 64)
    if (v !== undefined) data.userId = v
  }
  if (body.fullName !== undefined) {
    const v = strField(body.fullName, MAX_NAME_LEN)
    if (v === null || v === undefined) {
      return NextResponse.json(
        { error: "`fullName` cannot be cleared once set" },
        { status: 400 },
      )
    }
    // Slice-2 PII column wrap: encrypt fullName before persisting.
    data.fullName = encryptForTenantBound(orgId, TABLE, "fullName", v)
  }
  if (body.phone !== undefined) {
    const v = strField(body.phone, 32)
    if (v !== undefined) data.phone = v
  }
  if (body.agencySlug !== undefined) {
    const v = strField(body.agencySlug, 64)
    if (v === null || v === undefined) {
      return NextResponse.json(
        { error: "`agencySlug` cannot be cleared once set" },
        { status: 400 },
      )
    }
    data.agencySlug = v
  }
  if (body.departmentSlug !== undefined) {
    const v = strField(body.departmentSlug, 64)
    if (v !== undefined) data.departmentSlug = v
  }
  if (body.role !== undefined) {
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
    data.role = body.role
  }
  if (body.authorityLevel !== undefined) {
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
    data.authorityLevel = body.authorityLevel
  }
  if (body.specialties !== undefined) {
    const arr = parseSpecialties(body.specialties)
    if (arr === "invalid") {
      return NextResponse.json(
        {
          error:
            "`specialties` must be an array of strings (max 32 items, max 64 chars each)",
        },
        { status: 400 },
      )
    }
    if (arr !== undefined) data.specialties = arr
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") {
      return NextResponse.json(
        { error: "`isActive` must be boolean" },
        { status: 400 },
      )
    }
    data.isActive = body.isActive
  }
  if (body.metadata !== undefined) {
    if (
      body.metadata !== null &&
      (typeof body.metadata !== "object" || Array.isArray(body.metadata))
    ) {
      return NextResponse.json(
        { error: "Invalid `metadata` — must be plain object or null" },
        { status: 400 },
      )
    }
    data.metadata = body.metadata ?? {}
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "No mutable fields provided" },
      { status: 400 },
    )
  }

  try {
    const official = await prisma.publicSectorOfficial.update({
      where: { id },
      data,
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
        updatedAt: true,
      },
    })

    void recordFoiaAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: official.id,
      action: "write",
      metadata: {
        fields: Object.keys(data),
        roleChange: body.role !== undefined ? `→${body.role}` : undefined,
        authorityChange:
          body.authorityLevel !== undefined
            ? `→${body.authorityLevel}`
            : undefined,
      },
    })

    return NextResponse.json({
      official: {
        ...official,
        fullName: softDecryptForTenantBound(orgId, TABLE, "fullName", official.fullName),
      },
    })
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "An official with this identifier already exists" },
        { status: 409 },
      )
    }
    console.error("[public-sector-officials/:id] PATCH error:", err)
    return NextResponse.json(
      { error: "Failed to update official" },
      { status: 500 },
    )
  }
})
