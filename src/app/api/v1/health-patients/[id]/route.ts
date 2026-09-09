/**
 * R2 Health — patient per-id (slice-2-mini).
 *
 * GET /api/v1/health-patients/[id] — single-record PHI read.
 *   Every read logs as PHI access with the specific recordId.
 * PATCH /api/v1/health-patients/[id] — update patient fields.
 *   Write logged as PHI write.
 * DELETE — intentionally NOT exposed. Health records are append-only
 *   per HIPAA recommendation; status transitions (active → discharged
 *   → deceased) are the deletion analogue.
 *
 * Mutability:
 *   - `mrn` is immutable post-create (institutional identifier;
 *     renaming would break encounter / medical-record back-refs).
 *   - `status` transitions follow the slice-1 patient state machine
 *     (active ↔ inactive, → discharged/deceased terminal). Caller
 *     should use the state-machine helper before issuing PATCH.
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import {
  recordPhiAccessFromRequest,
} from "@/lib/audit/compliance-audit"
import { transitionPatient } from "@/lib/health/state-machine"
import {
  blindIndexForTenant,
  encryptForTenantBound,
  encryptForTenantBoundOrNull,
  softDecryptForTenantBound,
} from "@/lib/crypto/tenant-pii-encryption"

// Phase 7 slice-3 migration (2026-05-29): wired to column-bound AAD
// helpers. See route.ts header comment for rationale + rollout safety.

// PII columns encrypted at the slice-2 column-by-column wrap.
// Listed here so the PATCH optional-string-field loop knows which
// values to encrypt before persisting. Soft-decrypt on every read.
const PII_COLUMNS = new Set<string>([
  "sexAtBirth",
  "taxId",
  "addressLine1",
  "city",
  "postalCode",
  "country",
  "insuranceCarrier",
  "insurancePolicyId",
  "emergencyContactName",
  "emergencyContactPhone",
])

const TABLE = "health_patients"
const MAX_NAME_LEN = 200
const MAX_GENERIC_LEN = 200

function strField(v: unknown, max: number = MAX_GENERIC_LEN): string | null | undefined {
  // Three-way: undefined = not provided (don't touch), null = clear,
  // string = set. Empty trimmed string treated as clear.
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== "string") return undefined
  const trimmed = v.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

export const GET = withRlsAuth("health", "read", async (req: NextRequest, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing patient id" }, { status: 400 })
  }

  try {
    const patient = await prisma.healthPatient.findFirst({
      where: { id, organizationId: orgId },
      // No `select` — return the full row. Operator UI needs every
      // PHI field for the patient-detail page. Slice-2-mini follow-up
      // will swap PHI columns to decryptForTenantOrNull(orgId, ...) calls.
    })
    if (!patient) {
      // Even 404-paths must log — "operator tried to access record X
      // and was denied" is auditable.
      void recordPhiAccessFromRequest(req, auth, {
        recordTable: TABLE,
        recordId: id,
        action: "read",
        metadata: { result: "not_found" },
      })
      return NextResponse.json({ error: "Patient not found" }, { status: 404 })
    }

    // PHI read audit — success path.
    void recordPhiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: patient.id,
      action: "read",
      metadata: { mrn: patient.mrn, status: patient.status },
    })

    // Soft-decrypt every encrypted PII column. Soft-decrypt tolerates
    // legacy plaintext rows during the column-by-column rollout window.
    const patientResponse = {
      ...patient,
      fullName: softDecryptForTenantBound(orgId, TABLE, "fullName", patient.fullName),
      sexAtBirth: softDecryptForTenantBound(orgId, TABLE, "sexAtBirth", patient.sexAtBirth),
      taxId: softDecryptForTenantBound(orgId, TABLE, "taxId", patient.taxId),
      addressLine1: softDecryptForTenantBound(orgId, TABLE, "addressLine1", patient.addressLine1),
      city: softDecryptForTenantBound(orgId, TABLE, "city", patient.city),
      postalCode: softDecryptForTenantBound(orgId, TABLE, "postalCode", patient.postalCode),
      country: softDecryptForTenantBound(orgId, TABLE, "country", patient.country),
      insuranceCarrier: softDecryptForTenantBound(orgId, TABLE, "insuranceCarrier", patient.insuranceCarrier),
      insurancePolicyId: softDecryptForTenantBound(
        orgId,
        TABLE,
        "insurancePolicyId",
        patient.insurancePolicyId,
      ),
      emergencyContactName: softDecryptForTenantBound(
        orgId,
        TABLE,
        "emergencyContactName",
        patient.emergencyContactName,
      ),
      emergencyContactPhone: softDecryptForTenantBound(
        orgId,
        TABLE,
        "emergencyContactPhone",
        patient.emergencyContactPhone,
      ),
    }

    return NextResponse.json({ patient: patientResponse })
  } catch (err) {
    console.error("[health-patients/:id] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load patient" },
      { status: 500 },
    )
  }
})

interface PatchBody {
  fullName?: unknown
  email?: unknown
  phone?: unknown
  dateOfBirth?: unknown
  sexAtBirth?: unknown
  taxId?: unknown
  addressLine1?: unknown
  city?: unknown
  postalCode?: unknown
  country?: unknown
  insuranceCarrier?: unknown
  insurancePolicyId?: unknown
  emergencyContactName?: unknown
  emergencyContactPhone?: unknown
  status?: unknown
  primaryProviderId?: unknown
  metadata?: unknown
}

export const PATCH = withRlsAuth("health", "write", async (req: NextRequest, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing patient id" }, { status: 400 })
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const existing = await prisma.healthPatient.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, status: true, dischargedAt: true, deceasedAt: true },
  })
  if (!existing) {
    return NextResponse.json({ error: "Patient not found" }, { status: 404 })
  }

  const data: {
    fullName?: string | null
    fullNameBlindIndex?: string | null
    email?: string | null
    phone?: string | null
    dateOfBirth?: Date | null
    sexAtBirth?: string | null
    taxId?: string | null
    taxIdBlindIndex?: string | null
    addressLine1?: string | null
    city?: string | null
    postalCode?: string | null
    country?: string | null
    insuranceCarrier?: string | null
    insurancePolicyId?: string | null
    emergencyContactName?: string | null
    emergencyContactPhone?: string | null
    status?: string
    primaryProviderId?: string | null
    dischargedAt?: Date | null
    deceasedAt?: Date | null
    metadata?: unknown
  } = {}

  // Required-field guards. fullName is column-wrap PII (slice-2):
  // encrypt the plaintext before persisting. Soft-decrypt on read
  // tolerates legacy plaintext rows.
  if (body.fullName !== undefined) {
    const v = strField(body.fullName, MAX_NAME_LEN)
    if (v === null || v === undefined) {
      return NextResponse.json(
        { error: "`fullName` cannot be cleared once set" },
        { status: 400 },
      )
    }
    data.fullName = encryptForTenantBound(orgId, TABLE, "fullName", v)
    // Slice-3: re-compute the blind index alongside the new ciphertext
    // so GET-list `?fullName=` finds the updated row.
    data.fullNameBlindIndex = blindIndexForTenant(orgId, v)
  }

  // Slice-3 ext: handle taxId outside the generic optional-field loop
  // so the blind-index re-computation stays in lockstep with the
  // ciphertext write. Clearing taxId also clears the index.
  if (body.taxId !== undefined) {
    const v = strField(body.taxId, 64)
    if (v !== undefined) {
      data.taxId = encryptForTenantBoundOrNull(orgId, TABLE, "taxId", v)
      data.taxIdBlindIndex = blindIndexForTenant(orgId, v)
    }
  }

  // Optional string fields (three-way: skip / clear / set)
  const optionalStringFields: Array<[keyof PatchBody, keyof typeof data, number]> = [
    ["email", "email", MAX_GENERIC_LEN],
    ["phone", "phone", 32],
    ["sexAtBirth", "sexAtBirth", 32],
    ["addressLine1", "addressLine1", MAX_GENERIC_LEN],
    ["city", "city", 100],
    ["postalCode", "postalCode", 32],
    ["country", "country", 64],
    ["insuranceCarrier", "insuranceCarrier", MAX_GENERIC_LEN],
    ["insurancePolicyId", "insurancePolicyId", 64],
    ["emergencyContactName", "emergencyContactName", MAX_GENERIC_LEN],
    ["emergencyContactPhone", "emergencyContactPhone", 32],
    ["primaryProviderId", "primaryProviderId", 64],
  ]
  for (const [bodyKey, dataKey, max] of optionalStringFields) {
    if (body[bodyKey] !== undefined) {
      const v = strField(body[bodyKey], max)
      if (v !== undefined) {
        // Slice-2 column wrap: encrypt PII columns before persisting.
        // Non-PII fields (email/phone/primaryProviderId) pass through
        // as plaintext — email/phone may be indexed and primaryProviderId
        // is a FK.
        const stored = PII_COLUMNS.has(dataKey as string)
          ? encryptForTenantBoundOrNull(orgId, TABLE, dataKey as string, v)
          : v
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(data as any)[dataKey] = stored
      }
    }
  }

  // dateOfBirth
  if (body.dateOfBirth !== undefined) {
    if (body.dateOfBirth === null) {
      data.dateOfBirth = null
    } else if (typeof body.dateOfBirth === "string") {
      const d = new Date(body.dateOfBirth)
      if (isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "Invalid `dateOfBirth` — bad date" },
          { status: 400 },
        )
      }
      data.dateOfBirth = d
    } else {
      return NextResponse.json(
        { error: "Invalid `dateOfBirth`" },
        { status: 400 },
      )
    }
  }

  // status transition — use the slice-1 helper for legality check
  if (body.status !== undefined) {
    if (typeof body.status !== "string") {
      return NextResponse.json({ error: "Invalid `status`" }, { status: 400 })
    }
    const result = transitionPatient(existing.status, body.status)
    if (!result.ok) {
      return NextResponse.json(
        { error: `Illegal status transition: ${result.error}` },
        { status: 400 },
      )
    }
    data.status = body.status
    // Auto-set terminal timestamps for HIPAA audit-trail completeness.
    if (body.status === "discharged" && !existing.dischargedAt) {
      data.dischargedAt = new Date()
    }
    if (body.status === "deceased" && !existing.deceasedAt) {
      data.deceasedAt = new Date()
    }
  }

  // metadata (free-form JSONB)
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
    return NextResponse.json(
      { error: "No mutable fields provided" },
      { status: 400 },
    )
  }

  try {
    const patient = await prisma.healthPatient.update({
      where: { id },
      data,
      select: {
        id: true,
        mrn: true,
        fullName: true,
        status: true,
        primaryProviderId: true,
        updatedAt: true,
      },
    })

    void recordPhiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: patient.id,
      action: "write",
      metadata: {
        fields: Object.keys(data),
        statusChange:
          body.status !== undefined ? `${existing.status}→${body.status}` : undefined,
      },
    })

    // Decrypt encrypted PII columns for the response.
    const patientResponse = {
      ...patient,
      fullName: softDecryptForTenantBound(orgId, TABLE, "fullName", patient.fullName),
    }

    return NextResponse.json({ patient: patientResponse })
  } catch (err) {
    console.error("[health-patients/:id] PATCH error:", err)
    return NextResponse.json(
      { error: "Failed to update patient" },
      { status: 500 },
    )
  }
})
