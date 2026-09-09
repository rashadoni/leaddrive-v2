/**
 * R8 Public Sector — citizen per-id (slice-2-mini).
 * Mirrors PR #93 R2 + PR #94 R7 [id] route shapes. Third of trio.
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordFoiaAccessFromRequest } from "@/lib/audit/compliance-audit"
import { transitionCitizen } from "@/lib/public-sector/state-machine"
import {
  blindIndexForTenant,
  encryptForTenantBound,
  encryptForTenantBoundOrNull,
  softDecryptForTenantBound,
} from "@/lib/crypto/tenant-pii-encryption"
// Phase 7 slice-3 migration (2026-05-29): column-bound AAD on the 8
// PII columns (fullName + taxId + 6 address cols). See
// `citizens/route.ts` header for full rationale.

const TABLE = "citizens"
const MAX_GENERIC_LEN = 200

// PII columns encrypted at the slice-2 column-by-column wrap.
const PII_COLUMNS = new Set<string>([
  "taxId",
  "addressLine1",
  "addressLine2",
  "city",
  "stateProvince",
  "postalCode",
  "country",
])

function strField(v: unknown, max: number = MAX_GENERIC_LEN): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== "string") return undefined
  const trimmed = v.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

export const GET = withRlsAuth("public-sector", "read", async (req: NextRequest, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing citizen id" }, { status: 400 })
  }

  try {
    const citizen = await prisma.citizen.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!citizen) {
      void recordFoiaAccessFromRequest(req, auth, {
        recordTable: TABLE,
        recordId: id,
        action: "read",
        metadata: { result: "not_found" },
      })
      return NextResponse.json({ error: "Citizen not found" }, { status: 404 })
    }

    void recordFoiaAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: citizen.id,
      action: "read",
      metadata: {
        citizenNumber: citizen.citizenNumber,
        status: citizen.status,
        jurisdictionSlug: citizen.jurisdictionSlug,
      },
    })

    // Soft-decrypt encrypted PII columns. Tolerant of legacy plaintext
    // rows during the column-by-column rollout window.
    const citizenResponse = {
      ...citizen,
      fullName: softDecryptForTenantBound(orgId, TABLE, "fullName", citizen.fullName),
      taxId: softDecryptForTenantBound(orgId, TABLE, "taxId", citizen.taxId),
      addressLine1: softDecryptForTenantBound(orgId, TABLE, "addressLine1", citizen.addressLine1),
      addressLine2: softDecryptForTenantBound(orgId, TABLE, "addressLine2", citizen.addressLine2),
      city: softDecryptForTenantBound(orgId, TABLE, "city", citizen.city),
      stateProvince: softDecryptForTenantBound(orgId, TABLE, "stateProvince", citizen.stateProvince),
      postalCode: softDecryptForTenantBound(orgId, TABLE, "postalCode", citizen.postalCode),
      country: softDecryptForTenantBound(orgId, TABLE, "country", citizen.country),
    }

    return NextResponse.json({ citizen: citizenResponse })
  } catch (err) {
    console.error("[citizens/:id] GET error:", err)
    return NextResponse.json({ error: "Failed to load citizen" }, { status: 500 })
  }
})

interface PatchBody {
  fullName?: unknown
  email?: unknown
  phone?: unknown
  dateOfBirth?: unknown
  taxId?: unknown
  addressLine1?: unknown
  addressLine2?: unknown
  city?: unknown
  stateProvince?: unknown
  postalCode?: unknown
  country?: unknown
  jurisdictionSlug?: unknown
  status?: unknown
  metadata?: unknown
}

export const PATCH = withRlsAuth("public-sector", "write", async (req: NextRequest, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing citizen id" }, { status: 400 })
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const existing = await prisma.citizen.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, status: true, deactivatedAt: true, deceasedAt: true },
  })
  if (!existing) {
    return NextResponse.json({ error: "Citizen not found" }, { status: 404 })
  }

  const data: {
    fullName?: string | null
    fullNameBlindIndex?: string | null
    email?: string | null
    phone?: string | null
    dateOfBirth?: Date | null
    taxId?: string | null
    taxIdBlindIndex?: string | null
    addressLine1?: string | null
    addressLine2?: string | null
    city?: string | null
    stateProvince?: string | null
    postalCode?: string | null
    country?: string | null
    jurisdictionSlug?: string | null
    status?: string
    deactivatedAt?: Date | null
    deceasedAt?: Date | null
    metadata?: unknown
  } = {}

  if (body.fullName !== undefined) {
    const v = strField(body.fullName, MAX_GENERIC_LEN)
    if (v === null || v === undefined) {
      return NextResponse.json({ error: "`fullName` cannot be cleared once set" }, { status: 400 })
    }
    data.fullName = encryptForTenantBound(orgId, TABLE, "fullName", v)
    // Slice-3: re-compute blind index alongside the new ciphertext so
    // GET-list `?fullName=` finds the updated row.
    data.fullNameBlindIndex = blindIndexForTenant(orgId, v)
  }

  // Slice-3 ext: handle taxId specially (outside the generic optional-
  // string loop) so the blind-index gets re-computed in lockstep with
  // the ciphertext. Clearing taxId (passing null) also clears the
  // index — both columns stay in sync at all times.
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
    ["addressLine1", "addressLine1", MAX_GENERIC_LEN],
    ["addressLine2", "addressLine2", MAX_GENERIC_LEN],
    ["city", "city", 100],
    ["stateProvince", "stateProvince", 64],
    ["postalCode", "postalCode", 32],
    ["country", "country", 64],
    ["jurisdictionSlug", "jurisdictionSlug", 64],
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

  if (body.status !== undefined) {
    if (typeof body.status !== "string") {
      return NextResponse.json({ error: "Invalid `status`" }, { status: 400 })
    }
    const result = transitionCitizen(existing.status, body.status)
    if (!result.ok) {
      return NextResponse.json(
        { error: `Illegal status transition: ${result.error}` },
        { status: 400 },
      )
    }
    data.status = body.status
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
    const citizen = await prisma.citizen.update({
      where: { id },
      data,
      select: {
        id: true,
        citizenNumber: true,
        fullName: true,
        status: true,
        jurisdictionSlug: true,
        updatedAt: true,
      },
    })

    void recordFoiaAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: citizen.id,
      action: "write",
      metadata: {
        fields: Object.keys(data),
        statusChange: body.status !== undefined ? `${existing.status}→${body.status}` : undefined,
      },
    })

    return NextResponse.json({
      citizen: {
        ...citizen,
        fullName: softDecryptForTenantBound(orgId, TABLE, "fullName", citizen.fullName),
      },
    })
  } catch (err) {
    console.error("[citizens/:id] PATCH error:", err)
    return NextResponse.json({ error: "Failed to update citizen" }, { status: 500 })
  }
})
