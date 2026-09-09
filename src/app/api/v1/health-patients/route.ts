/**
 * R2 Health — patient roster / create (slice-2-mini).
 *
 * GET /api/v1/health-patients — paginated patient list. Every list
 *   read is logged as a PHI access (HIPAA minimum-necessary —
 *   even "I scanned the roster" is auditable).
 * POST /api/v1/health-patients — create new patient. Write logged
 *   as PHI write.
 *
 * This is the first real route-layer consumer of the compliance-audit
 * primitives shipped in PR #75. Future route work (R7 Insurance,
 * R8 Public Sector) follows the same shape.
 *
 * Encryption note: PHI columns (fullName / dateOfBirth / taxId / etc.)
 * are stored in plaintext today. PR #89 shipped the
 * encryptForTenantOrNull / decryptForTenantOrNull primitives; wiring
 * them column-by-column is a follow-up (each column flip is one
 * commit to avoid mass-corruption risk during the migration).
 * Operators must NOT load real PHI until that wrap completes.
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import {
  recordPhiAccessFromRequest,
} from "@/lib/audit/compliance-audit"
import { createNotification } from "@/lib/notifications"
import {
  blindIndexForTenant,
  encryptForTenantBound,
  encryptForTenantBoundOrNull,
  softDecryptForTenantBound,
} from "@/lib/crypto/tenant-pii-encryption"

// Phase 7 slice-3 migration (2026-05-29): wired to column-bound AAD
// helpers. AAD now binds to (orgId, TABLE, "<column>"), preventing
// same-tenant cross-column ciphertext shuffle attacks (e.g. copying
// `fullName` ciphertext into `taxId`). Soft-decrypt fallback inside
// `softDecryptForTenantBound` handles legacy orgId-only AAD rows
// during rollout — no DB migration needed.
const TABLE = "health_patients"
const MAX_PAGE_SIZE = 200

export const GET = withRlsAuth("health", "read", async (req: NextRequest, auth) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const limitRaw = searchParams.get("limit")
  const cursor = searchParams.get("cursor")
  const status = searchParams.get("status")
  const search = searchParams.get("search")
  // Slice-3 blind-index filter: exact-match on encrypted fullName.
  // Same shape as citizens `?fullName=` (PR #160). Caller can supply
  // any-case / extra-whitespace; normalization inside
  // `blindIndexForTenant()` produces a stable hash.
  const fullNameFilter = searchParams.get("fullName")
  // Slice-3 ext: same shape for ?taxId=. Payer-record cross-reference
  // is the common HIPAA-authorized lookup use case.
  const taxIdFilter = searchParams.get("taxId")

  const limit = (() => {
    if (!limitRaw) return 50
    const n = Number(limitRaw)
    if (!Number.isInteger(n) || n <= 0) return 50
    return Math.min(n, MAX_PAGE_SIZE)
  })()

  const where: {
    organizationId: string
    status?: string
    fullNameBlindIndex?: string
    taxIdBlindIndex?: string
    OR?: Array<Record<string, { contains: string; mode: "insensitive" }>>
  } = { organizationId: orgId }
  if (status) where.status = status
  // Slice-3 (restored): exact-match search on encrypted fullName via
  // the blind-index column. Substring search would require n-gram
  // tokenization (slice-3+). Whitespace-only filter is a no-op.
  if (fullNameFilter && fullNameFilter.trim().length > 0) {
    const hash = blindIndexForTenant(orgId, fullNameFilter)
    if (hash) where.fullNameBlindIndex = hash
  }
  if (taxIdFilter && taxIdFilter.trim().length > 0) {
    const hash = blindIndexForTenant(orgId, taxIdFilter)
    if (hash) where.taxIdBlindIndex = hash
  }
  // Legacy `?search=` still scans mrn + email (plaintext columns).
  if (search && search.length > 0) {
    where.OR = [
      { mrn: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ]
  }

  try {
    const patients = await prisma.healthPatient.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit + 1, // over-fetch for hasMore
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        mrn: true,
        fullName: true,
        email: true,
        phone: true,
        status: true,
        primaryProviderId: true,
        registeredAt: true,
        createdAt: true,
      },
    })
    const hasMore = patients.length > limit
    const rawRows = hasMore ? patients.slice(0, limit) : patients
    // Soft-decrypt fullName for each row. Soft = pre-backfill
    // tolerant — encrypted values come back as plaintext, legacy
    // plaintext rows pass through unchanged.
    const rows = rawRows.map((p: { fullName: string } & Record<string, unknown>) => ({
      ...p,
      fullName: softDecryptForTenantBound(orgId, TABLE, "fullName", p.fullName),
    }))
    const nextCursor = hasMore ? rows[rows.length - 1].id as string : null

    // PHI list audit — fire-and-forget. Roster scan is a PHI access
    // even though no single recordId is identified.
    void recordPhiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: null, // list read — no single record
      action: "read",
      metadata: {
        limit,
        cursor,
        status: status ?? null,
        searchHit: search !== null && search.length > 0,
        // Surface blind-index lookups in the HIPAA audit row so a
        // records-request can answer "did this reader search for
        // patient by name?".
        fullNameFilterHit:
          fullNameFilter !== null && fullNameFilter.trim().length > 0,
        taxIdFilterHit:
          taxIdFilter !== null && taxIdFilter.trim().length > 0,
        rowCount: rows.length,
      },
    })

    const response = NextResponse.json({ patients: rows, hasMore, nextCursor })
    // Deprecation signal (RFC 8594): plaintext PHI in URL query params
    // is logged by nginx access log. Callers should migrate to
    // POST /api/v1/health-patients/lookup which keeps PHI in the body.
    if (
      (fullNameFilter && fullNameFilter.trim().length > 0) ||
      (taxIdFilter && taxIdFilter.trim().length > 0)
    ) {
      response.headers.set("Deprecation", "true")
      response.headers.set(
        "Link",
        "</api/v1/health-patients/lookup>; rel=\"successor-version\"",
      )
    }
    return response
  } catch (err) {
    console.error("[health-patients] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load patients" },
      { status: 500 },
    )
  }
})

interface CreateBody {
  mrn?: unknown
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
  primaryProviderId?: unknown
  contactId?: unknown
}

const MAX_NAME_LEN = 200
const MAX_MRN_LEN = 64
const MAX_GENERIC_LEN = 200

function strField(v: unknown, max: number = MAX_GENERIC_LEN): string | null {
  if (typeof v !== "string") return null
  const trimmed = v.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

export const POST = withRlsAuth("health", "write", async (req: NextRequest, auth) => {
  const orgId = auth.orgId

  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const mrn = strField(body.mrn, MAX_MRN_LEN)
  if (!mrn) {
    return NextResponse.json(
      { error: "`mrn` (medical record number) is required" },
      { status: 400 },
    )
  }
  const fullName = strField(body.fullName, MAX_NAME_LEN)
  if (!fullName) {
    return NextResponse.json(
      { error: "`fullName` is required" },
      { status: 400 },
    )
  }

  // Optional fields — all PHI; will be encrypted column-by-column
  // in a follow-up wrap pass.
  let dob: Date | null = null
  if (body.dateOfBirth !== undefined && body.dateOfBirth !== null) {
    if (typeof body.dateOfBirth !== "string") {
      return NextResponse.json(
        { error: "Invalid `dateOfBirth`" },
        { status: 400 },
      )
    }
    const d = new Date(body.dateOfBirth)
    if (isNaN(d.getTime())) {
      return NextResponse.json(
        { error: "Invalid `dateOfBirth` — bad date" },
        { status: 400 },
      )
    }
    dob = d
  }

  // PII column encryption (slice-2 column-by-column wrap): encrypt
  // every PHI/PII column at the route boundary. Stored ciphertext is
  // base64 AES-256-GCM with the per-tenant DEK + orgId as AAD. Read
  // paths soft-decrypt (tolerant of legacy plaintext rows during rollout).
  // Non-PII passthrough: mrn (institutional id), email/phone (already
  // subject to separate breach-disclosure rules + may need indexing),
  // dateOfBirth (typed Date), primaryProviderId / contactId (FKs).
  const fullNameCiphertext = encryptForTenantBound(orgId, TABLE, "fullName", fullName)
  // Slice-3 blind index — written alongside the ciphertext so the
  // GET-list `?fullName=` filter can hit the indexed column.
  const fullNameBlindIndexValue = blindIndexForTenant(orgId, fullName)
  const sexAtBirthCiphertext = encryptForTenantBoundOrNull(
    orgId,
    TABLE,
    "sexAtBirth",
    strField(body.sexAtBirth, 32),
  )
  // Compute plaintext once so encryption + blind-index see the same
  // normalized source. Both columns either populate together or stay
  // NULL together.
  const plainTaxId = strField(body.taxId, 64)
  const taxIdCiphertext = encryptForTenantBoundOrNull(orgId, TABLE, "taxId", plainTaxId)
  const taxIdBlindIndexValue = blindIndexForTenant(orgId, plainTaxId)
  const addressLine1Ciphertext = encryptForTenantBoundOrNull(
    orgId,
    TABLE,
    "addressLine1",
    strField(body.addressLine1),
  )
  const cityCiphertext = encryptForTenantBoundOrNull(
    orgId,
    TABLE,
    "city",
    strField(body.city, 100),
  )
  const postalCodeCiphertext = encryptForTenantBoundOrNull(
    orgId,
    TABLE,
    "postalCode",
    strField(body.postalCode, 32),
  )
  const countryCiphertext = encryptForTenantBoundOrNull(
    orgId,
    TABLE,
    "country",
    strField(body.country, 64),
  )
  const insuranceCarrierCiphertext = encryptForTenantBoundOrNull(
    orgId,
    TABLE,
    "insuranceCarrier",
    strField(body.insuranceCarrier),
  )
  const insurancePolicyIdCiphertext = encryptForTenantBoundOrNull(
    orgId,
    TABLE,
    "insurancePolicyId",
    strField(body.insurancePolicyId, 64),
  )
  const emergencyContactNameCiphertext = encryptForTenantBoundOrNull(
    orgId,
    TABLE,
    "emergencyContactName",
    strField(body.emergencyContactName),
  )
  const emergencyContactPhoneCiphertext = encryptForTenantBoundOrNull(
    orgId,
    TABLE,
    "emergencyContactPhone",
    strField(body.emergencyContactPhone, 32),
  )

  try {
    const patient = await prisma.healthPatient.create({
      data: {
        organizationId: orgId,
        mrn,
        fullName: fullNameCiphertext,
        fullNameBlindIndex: fullNameBlindIndexValue,
        email: strField(body.email),
        phone: strField(body.phone),
        dateOfBirth: dob,
        sexAtBirth: sexAtBirthCiphertext,
        taxId: taxIdCiphertext,
        taxIdBlindIndex: taxIdBlindIndexValue,
        addressLine1: addressLine1Ciphertext,
        city: cityCiphertext,
        postalCode: postalCodeCiphertext,
        country: countryCiphertext,
        insuranceCarrier: insuranceCarrierCiphertext,
        insurancePolicyId: insurancePolicyIdCiphertext,
        emergencyContactName: emergencyContactNameCiphertext,
        emergencyContactPhone: emergencyContactPhoneCiphertext,
        primaryProviderId: strField(body.primaryProviderId, 64),
        contactId: strField(body.contactId, 64),
      },
      select: { id: true, mrn: true, fullName: true, status: true, createdAt: true },
    })

    // Decrypt fullName back to plaintext for the response. The DB
    // stores ciphertext; the client expects plaintext.
    const patientResponse = {
      ...patient,
      fullName: softDecryptForTenantBound(orgId, TABLE, "fullName", patient.fullName),
    }

    // PHI write audit.
    void recordPhiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: patient.id,
      action: "write",
      metadata: { mrn: patient.mrn },
    })

    // Phase 2d notification — org-wide in-app only, PII-safe (no decrypted fields).
    // Best-effort: .catch() so it never blocks the response.
    createNotification({
      organizationId: orgId,
      userId: "",
      type: "info",
      title: "New patient record",
      message: "A new patient record has been created",
      entityType: "health_patient",
      entityId: patient.id,
      kind: "health_patient.created",
    }).catch(() => {})

    return NextResponse.json({ patient: patientResponse }, { status: 201 })
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A patient with this `mrn` already exists for this tenant" },
        { status: 409 },
      )
    }
    console.error("[health-patients] POST error:", err)
    return NextResponse.json(
      { error: "Failed to create patient" },
      { status: 500 },
    )
  }
})
