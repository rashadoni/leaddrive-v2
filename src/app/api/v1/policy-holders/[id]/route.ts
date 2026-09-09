/**
 * R7 Insurance — policy-holder per-id (slice-2-mini).
 * Mirrors PR #93 R2 health-patients/[id] pattern.
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { recordPiiAccessFromRequest } from "@/lib/audit/compliance-audit"
import { withRlsAuth } from "@/lib/with-rls"
import { transitionHolder } from "@/lib/insurance/state-machine"
import {
  blindIndexForTenant,
  encryptForTenantBound,
  encryptForTenantBoundOrNull,
  softDecryptForTenantBound,
} from "@/lib/crypto/tenant-pii-encryption"

// Phase 7 slice-3 migration (2026-05-29): column-bound AAD.
// See `policy-holders/route.ts` header comment for rationale.
const TABLE = "policy_holders"
const MAX_GENERIC_LEN = 200

// PII columns encrypted at the slice-2 column-by-column wrap.
const PII_COLUMNS = new Set<string>([
  "taxId",
  "mailingAddressLine1",
  "mailingCity",
  "mailingPostalCode",
  "mailingCountry",
])

function strField(v: unknown, max: number = MAX_GENERIC_LEN): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== "string") return undefined
  const trimmed = v.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

export const GET = withRlsAuth("insurance", "read", async (req: NextRequest, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing holder id" }, { status: 400 })
  }

  try {
    const holder = await prisma.policyHolder.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!holder) {
      void recordPiiAccessFromRequest(req, auth, {
        recordTable: TABLE,
        recordId: id,
        action: "read",
        metadata: { result: "not_found" },
      })
      return NextResponse.json({ error: "Policy holder not found" }, { status: 404 })
    }

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: holder.id,
      action: "read",
      metadata: { holderNumber: holder.holderNumber, status: holder.status },
    })

    // Soft-decrypt encrypted PII columns. Soft-decrypt tolerates
    // legacy plaintext rows during the column-by-column rollout.
    const holderResponse = {
      ...holder,
      fullName: softDecryptForTenantBound(orgId, TABLE, "fullName", holder.fullName),
      taxId: softDecryptForTenantBound(orgId, TABLE, "taxId", holder.taxId),
      mailingAddressLine1: softDecryptForTenantBound(
        orgId,
        TABLE,
        "mailingAddressLine1",
        holder.mailingAddressLine1,
      ),
      mailingCity: softDecryptForTenantBound(orgId, TABLE, "mailingCity", holder.mailingCity),
      mailingPostalCode: softDecryptForTenantBound(orgId, TABLE, "mailingPostalCode", holder.mailingPostalCode),
      mailingCountry: softDecryptForTenantBound(orgId, TABLE, "mailingCountry", holder.mailingCountry),
    }

    return NextResponse.json({ holder: holderResponse })
  } catch (err) {
    console.error("[policy-holders/:id] GET error:", err)
    return NextResponse.json({ error: "Failed to load holder" }, { status: 500 })
  }
})

interface PatchBody {
  fullName?: unknown
  email?: unknown
  phone?: unknown
  dateOfBirth?: unknown
  taxId?: unknown
  mailingAddressLine1?: unknown
  mailingCity?: unknown
  mailingPostalCode?: unknown
  mailingCountry?: unknown
  occupationSlug?: unknown
  status?: unknown
  metadata?: unknown
}

export const PATCH = withRlsAuth("insurance", "write", async (req: NextRequest, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing holder id" }, { status: 400 })
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const existing = await prisma.policyHolder.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, status: true, activatedAt: true, deactivatedAt: true, deceasedAt: true },
  })
  if (!existing) {
    return NextResponse.json({ error: "Policy holder not found" }, { status: 404 })
  }

  const data: {
    fullName?: string | null
    fullNameBlindIndex?: string | null
    email?: string | null
    phone?: string | null
    dateOfBirth?: Date | null
    taxId?: string | null
    taxIdBlindIndex?: string | null
    mailingAddressLine1?: string | null
    mailingCity?: string | null
    mailingPostalCode?: string | null
    mailingCountry?: string | null
    occupationSlug?: string | null
    status?: string
    activatedAt?: Date | null
    deactivatedAt?: Date | null
    deceasedAt?: Date | null
    metadata?: unknown
  } = {}

  // Slice-2 PII column wrap: encrypt fullName (required) at the route
  // boundary; optional PII columns get encrypted in the loop below.
  if (body.fullName !== undefined) {
    const v = strField(body.fullName, MAX_GENERIC_LEN)
    if (v === null || v === undefined) {
      return NextResponse.json({ error: "`fullName` cannot be cleared once set" }, { status: 400 })
    }
    data.fullName = encryptForTenantBound(orgId, TABLE, "fullName", v)
    // Slice-3: re-compute blind index alongside the new ciphertext.
    data.fullNameBlindIndex = blindIndexForTenant(orgId, v)
  }

  // Slice-3 ext: handle taxId outside the generic loop so the blind-
  // index re-computes in lockstep with the ciphertext write.
  if (body.taxId !== undefined) {
    const v = strField(body.taxId, 64)
    if (v !== undefined) {
      data.taxId = encryptForTenantBoundOrNull(orgId, TABLE, "taxId", v)
      data.taxIdBlindIndex = blindIndexForTenant(orgId, v)
    }
  }

  const optionalFields: Array<[keyof PatchBody, keyof typeof data, number]> = [
    ["email", "email", MAX_GENERIC_LEN],
    ["phone", "phone", 32],
    ["mailingAddressLine1", "mailingAddressLine1", MAX_GENERIC_LEN],
    ["mailingCity", "mailingCity", 100],
    ["mailingPostalCode", "mailingPostalCode", 32],
    ["mailingCountry", "mailingCountry", 64],
    ["occupationSlug", "occupationSlug", 64],
  ]
  for (const [bodyKey, dataKey, max] of optionalFields) {
    if (body[bodyKey] !== undefined) {
      const v = strField(body[bodyKey], max)
      if (v !== undefined) {
        // Slice-2 column wrap: encrypt PII columns before persisting.
        const stored = PII_COLUMNS.has(dataKey as string)
          ? encryptForTenantBoundOrNull(orgId, TABLE, dataKey as string, v)
          : v
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(data as any)[dataKey] = stored
      }
    }
  }

  if (body.dateOfBirth !== undefined) {
    if (body.dateOfBirth === null) {
      data.dateOfBirth = null
    } else if (typeof body.dateOfBirth === "string") {
      const d = new Date(body.dateOfBirth)
      if (isNaN(d.getTime())) {
        return NextResponse.json({ error: "Invalid `dateOfBirth`" }, { status: 400 })
      }
      data.dateOfBirth = d
    } else {
      return NextResponse.json({ error: "Invalid `dateOfBirth`" }, { status: 400 })
    }
  }

  // Status transition via slice-1 helper (HOLDER_TRANSITIONS).
  if (body.status !== undefined) {
    if (typeof body.status !== "string") {
      return NextResponse.json({ error: "Invalid `status`" }, { status: 400 })
    }
    const result = transitionHolder(existing.status, body.status)
    if (!result.ok) {
      return NextResponse.json(
        { error: `Illegal status transition: ${result.error}` },
        { status: 400 },
      )
    }
    data.status = body.status
    // Auto-set lifecycle timestamps.
    if (body.status === "active" && !existing.activatedAt) data.activatedAt = new Date()
    if (body.status === "inactive" && !existing.deactivatedAt) data.deactivatedAt = new Date()
    if (body.status === "deceased" && !existing.deceasedAt) data.deceasedAt = new Date()
  }

  if (body.metadata !== undefined) {
    if (body.metadata !== null && (typeof body.metadata !== "object" || Array.isArray(body.metadata))) {
      return NextResponse.json(
        { error: "Invalid `metadata` — must be plain object or null" },
        { status: 400 },
      )
    }
    data.metadata = body.metadata ?? {}
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No mutable fields provided" }, { status: 400 })
  }

  try {
    const holder = await prisma.policyHolder.update({
      where: { id },
      data,
      select: { id: true, holderNumber: true, fullName: true, status: true, updatedAt: true },
    })

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: holder.id,
      action: "write",
      metadata: {
        fields: Object.keys(data),
        statusChange: body.status !== undefined ? `${existing.status}→${body.status}` : undefined,
      },
    })

    return NextResponse.json({
      holder: {
        ...holder,
        fullName: softDecryptForTenantBound(orgId, TABLE, "fullName", holder.fullName),
      },
    })
  } catch (err) {
    console.error("[policy-holders/:id] PATCH error:", err)
    return NextResponse.json({ error: "Failed to update holder" }, { status: 500 })
  }
})
