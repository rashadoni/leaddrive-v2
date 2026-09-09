/**
 * R7 Insurance — service team member per-id (slice-2-mini).
 *
 * GET — single read + 404 audit (PII).
 * PATCH — mutable fields. email immutable de-facto (UNIQUE per
 *   tenant). DELETE NOT exposed — referenced by policies + claims;
 *   use isActive=false to retire.
 */
import { NextResponse } from "next/server"
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
const MAX_NAME_LEN = 200

function strField(v: unknown, max: number): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== "string") return undefined
  const t = v.trim()
  if (!t) return null
  return t.slice(0, max)
}

function parseStringArray(
  v: unknown,
  allowList: readonly string[] | null,
  maxItems: number,
  maxItemLen: number,
): string[] | "invalid" | undefined {
  if (v === undefined) return undefined
  if (v === null) return []
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

export const GET = withRlsAuth("insurance", "read", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json(
      { error: "Missing member id" },
      { status: 400 },
    )
  }

  try {
    const member = await prisma.insuranceServiceTeamMember.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!member) {
      void recordPiiAccessFromRequest(req, auth, {
        recordTable: TABLE,
        recordId: id,
        action: "read",
        metadata: { result: "not_found" },
      })
      return NextResponse.json(
        { error: "Service team member not found" },
        { status: 404 },
      )
    }

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: member.id,
      action: "read",
      metadata: {
        email: member.email,
        role: member.role,
        isActive: member.isActive,
      },
    })

    return NextResponse.json({
      member: {
        ...member,
        fullName: softDecryptForTenantBound(orgId, TABLE, "fullName", member.fullName),
      },
    })
  } catch (err) {
    console.error("[insurance-service-team-members/:id] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load member" },
      { status: 500 },
    )
  }
})

interface PatchBody {
  userId?: unknown
  fullName?: unknown
  phone?: unknown
  role?: unknown
  licenseNumber?: unknown
  licensedRegions?: unknown
  linesSpecialty?: unknown
  isActive?: unknown
  metadata?: unknown
}

export const PATCH = withRlsAuth("insurance", "write", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json(
      { error: "Missing member id" },
      { status: 400 },
    )
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const existing = await prisma.insuranceServiceTeamMember.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  })
  if (!existing) {
    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: id,
      action: "write",
      metadata: { result: "not_found" },
    })
    return NextResponse.json(
      { error: "Service team member not found" },
      { status: 404 },
    )
  }

  const data: {
    userId?: string | null
    fullName?: string
    phone?: string | null
    role?: string
    licenseNumber?: string | null
    licensedRegions?: string[]
    linesSpecialty?: string[]
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
  if (body.role !== undefined) {
    if (
      typeof body.role !== "string" ||
      !(SERVICE_TEAM_ROLES as readonly string[]).includes(body.role)
    ) {
      return NextResponse.json(
        {
          error: `Invalid \`role\` — must be one of: ${SERVICE_TEAM_ROLES.join(", ")}`,
        },
        { status: 400 },
      )
    }
    data.role = body.role
  }
  if (body.licenseNumber !== undefined) {
    const v = strField(body.licenseNumber, 64)
    if (v !== undefined) data.licenseNumber = v
  }
  if (body.licensedRegions !== undefined) {
    const arr = parseStringArray(body.licensedRegions, null, 16, 32)
    if (arr === "invalid") {
      return NextResponse.json(
        {
          error:
            "`licensedRegions` must be an array of strings (max 16 items, max 32 chars each)",
        },
        { status: 400 },
      )
    }
    if (arr !== undefined) data.licensedRegions = arr
  }
  if (body.linesSpecialty !== undefined) {
    const arr = parseStringArray(
      body.linesSpecialty,
      LINES_OF_BUSINESS,
      LINES_OF_BUSINESS.length,
      32,
    )
    if (arr === "invalid") {
      return NextResponse.json(
        {
          error: `\`linesSpecialty\` must be an array of strings from: ${LINES_OF_BUSINESS.join(", ")}`,
        },
        { status: 400 },
      )
    }
    if (arr !== undefined) data.linesSpecialty = arr
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
    const member = await prisma.insuranceServiceTeamMember.update({
      where: { id },
      data,
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
        updatedAt: true,
      },
    })

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: member.id,
      action: "write",
      metadata: { fields: Object.keys(data) },
    })

    return NextResponse.json({
      member: {
        ...member,
        fullName: softDecryptForTenantBound(orgId, TABLE, "fullName", member.fullName),
      },
    })
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A service team member with this identifier already exists" },
        { status: 409 },
      )
    }
    console.error("[insurance-service-team-members/:id] PATCH error:", err)
    return NextResponse.json(
      { error: "Failed to update member" },
      { status: 500 },
    )
  }
})
