/**
 * R2 Health — provider per-id (slice-2-mini).
 *
 * GET — single read + 404 audit (PHI).
 * PATCH — three-way string handling on mutable fields. email immutable
 *   (UNIQUE per tenant, swap would forge identity). isActive +
 *   role + specialty + departmentSlug all mutable.
 *
 * DELETE intentionally NOT exposed — providers are referenced by
 * historical encounters / medical-records / patients; use
 * `isActive=false` to retire.
 */
import { NextResponse } from "next/server"
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

export const GET = withRlsAuth("health", "read", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json(
      { error: "Missing provider id" },
      { status: 400 },
    )
  }

  try {
    const provider = await prisma.healthProvider.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!provider) {
      void recordPhiAccessFromRequest(req, auth, {
        recordTable: TABLE,
        recordId: id,
        action: "read",
        metadata: { result: "not_found" },
      })
      return NextResponse.json(
        { error: "Provider not found" },
        { status: 404 },
      )
    }

    void recordPhiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: provider.id,
      action: "read",
      metadata: {
        email: provider.email,
        role: provider.role,
        specialty: provider.specialty,
        isActive: provider.isActive,
      },
    })

    return NextResponse.json({
      provider: {
        ...provider,
        fullName: softDecryptForTenantBound(orgId, TABLE, "fullName", provider.fullName),
      },
    })
  } catch (err) {
    console.error("[health-providers/:id] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load provider" },
      { status: 500 },
    )
  }
})

interface PatchBody {
  userId?: unknown
  fullName?: unknown
  phone?: unknown
  npiNumber?: unknown
  role?: unknown
  specialty?: unknown
  departmentSlug?: unknown
  isActive?: unknown
  metadata?: unknown
}

export const PATCH = withRlsAuth("health", "write", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json(
      { error: "Missing provider id" },
      { status: 400 },
    )
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const existing = await prisma.healthProvider.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  })
  if (!existing) {
    void recordPhiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: id,
      action: "write",
      metadata: { result: "not_found" },
    })
    return NextResponse.json(
      { error: "Provider not found" },
      { status: 404 },
    )
  }

  const data: {
    userId?: string | null
    fullName?: string
    phone?: string | null
    npiNumber?: string | null
    role?: string
    specialty?: string | null
    departmentSlug?: string | null
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
  if (body.specialty !== undefined) {
    const v = strField(body.specialty, MAX_GENERIC_LEN)
    if (v !== undefined) data.specialty = v
  }
  if (body.departmentSlug !== undefined) {
    const v = strField(body.departmentSlug, 64)
    if (v !== undefined) data.departmentSlug = v
  }
  if (body.role !== undefined) {
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
    data.role = body.role
  }

  if (body.npiNumber !== undefined) {
    if (body.npiNumber === null) {
      data.npiNumber = null
    } else if (typeof body.npiNumber === "string") {
      const trimmed = body.npiNumber.trim()
      if (trimmed.length < 8 || trimmed.length > 32) {
        return NextResponse.json(
          { error: "`npiNumber` must be 8-32 chars" },
          { status: 400 },
        )
      }
      data.npiNumber = trimmed
    } else {
      return NextResponse.json(
        { error: "Invalid `npiNumber`" },
        { status: 400 },
      )
    }
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
    const provider = await prisma.healthProvider.update({
      where: { id },
      data,
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
        updatedAt: true,
      },
    })

    void recordPhiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: provider.id,
      action: "write",
      metadata: { fields: Object.keys(data) },
    })

    return NextResponse.json({
      provider: {
        ...provider,
        fullName: softDecryptForTenantBound(orgId, TABLE, "fullName", provider.fullName),
      },
    })
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A provider with this identifier already exists" },
        { status: 409 },
      )
    }
    console.error("[health-providers/:id] PATCH error:", err)
    return NextResponse.json(
      { error: "Failed to update provider" },
      { status: 500 },
    )
  }
})
