/**
 * R8 Public Sector — citizen roster / create (slice-2-mini).
 *
 * Third of R2/R7/R8 slice-2-mini route trio. Mirrors PR #93
 * (R2 health-patients) and PR #94 (R7 policy-holders). FOIA audit
 * via `recordFoiaAccessFromRequest` — every citizen-data read is
 * FOIA-able and logged with operator id + timestamp.
 *
 * FOIA threat model: a citizen records-request can demand "who read
 * my file between dates X and Y?". The compliance_audit_log
 * (PR #75 + #81) is the answer source. Every route here logs to
 * it on read AND write paths.
 *
 * PII encryption deferred — same column-by-column follow-up plan
 * as R2/R7. Operators MUST NOT load real citizen data until the
 * wrap pass completes.
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordFoiaAccessFromRequest } from "@/lib/audit/compliance-audit"
import {
  blindIndexForTenant,
  encryptForTenantBound,
  encryptForTenantBoundOrNull,
  softDecryptForTenantBound,
} from "@/lib/crypto/tenant-pii-encryption"

// Phase 7 slice-3 migration (2026-05-29): column-bound AAD on the 8
// PII columns (fullName + taxId + 6 address columns). AAD binds to
// (orgId, citizens, "<column>"); soft-decrypt fallback handles slice-2
// ciphertext + pre-wrap plaintext rows during rollout.
const TABLE = "citizens"
const MAX_PAGE_SIZE = 200
const MAX_GENERIC_LEN = 200

function strField(v: unknown, max: number = MAX_GENERIC_LEN): string | null {
  if (typeof v !== "string") return null
  const trimmed = v.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

export const GET = withRlsAuth("public-sector", "read", async (req, auth) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const limitRaw = searchParams.get("limit")
  const cursor = searchParams.get("cursor")
  const status = searchParams.get("status")
  const search = searchParams.get("search")
  const jurisdictionSlug = searchParams.get("jurisdictionSlug")
  // Slice-3 blind-index filter: exact-match search on the encrypted
  // fullName column. Caller passes any-case / extra-whitespace; the
  // normalization inside blindIndexForTenant() handles the rest.
  // Replaces the substring search that was disabled when fullName
  // was encrypted in PR #69.
  const fullNameFilter = searchParams.get("fullName")
  // Slice-3 ext: same shape for taxId. SSN lookups are a common FOIA
  // records-request workflow at the state agency level.
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
    jurisdictionSlug?: string
    fullNameBlindIndex?: string
    taxIdBlindIndex?: string
    OR?: Array<Record<string, { contains: string; mode: "insensitive" }>>
  } = { organizationId: orgId }
  if (status) where.status = status
  if (jurisdictionSlug) where.jurisdictionSlug = jurisdictionSlug
  // Slice-3 (restored): exact-match search on encrypted fullName via
  // the blind-index column. Returns the indexed hash and filters
  // server-side. Empty/whitespace-only filter inputs are no-ops.
  if (fullNameFilter && fullNameFilter.trim().length > 0) {
    const hash = blindIndexForTenant(orgId, fullNameFilter)
    if (hash) where.fullNameBlindIndex = hash
  }
  // Slice-3 ext: same shape for ?taxId=. blindIndexForTenant() trims
  // + normalizes the input, so "123-45-6789" and " 123-45-6789 "
  // resolve to the same hash. Whitespace-only inputs are skipped.
  if (taxIdFilter && taxIdFilter.trim().length > 0) {
    const hash = blindIndexForTenant(orgId, taxIdFilter)
    if (hash) where.taxIdBlindIndex = hash
  }
  // fullName substring search is intentionally NOT restored — would
  // require n-gram tokenization (slice-3+ work). The exact-match
  // above is the immediate win for "find this exact name" callers.
  // Search hits citizenNumber + email only.
  if (search && search.length > 0) {
    where.OR = [
      { citizenNumber: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ]
  }

  try {
    const citizens = await prisma.citizen.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        citizenNumber: true,
        fullName: true,
        email: true,
        phone: true,
        status: true,
        jurisdictionSlug: true,
        createdAt: true,
      },
    })
    const hasMore = citizens.length > limit
    const rawRows = hasMore ? citizens.slice(0, limit) : citizens
    const rows = rawRows.map(
      (c: { fullName: string } & Record<string, unknown>) => ({
        ...c,
        fullName: softDecryptForTenantBound(orgId, TABLE, "fullName", c.fullName),
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
        status: status ?? null,
        jurisdictionSlug: jurisdictionSlug ?? null,
        searchHit: search !== null && search.length > 0,
        // Surface blind-index lookups in the FOIA audit row — a
        // records-request can answer "did this reader search for
        // citizen by name?".
        fullNameFilterHit:
          fullNameFilter !== null && fullNameFilter.trim().length > 0,
        taxIdFilterHit:
          taxIdFilter !== null && taxIdFilter.trim().length > 0,
        rowCount: rows.length,
      },
    })

    const response = NextResponse.json({ citizens: rows, hasMore, nextCursor })
    // Deprecation signal (RFC 8594): plaintext PII in URL query params
    // is logged by nginx access log. Callers should migrate to
    // POST /api/v1/citizens/lookup which keeps PII in the request body.
    if (
      (fullNameFilter && fullNameFilter.trim().length > 0) ||
      (taxIdFilter && taxIdFilter.trim().length > 0)
    ) {
      response.headers.set("Deprecation", "true")
      response.headers.set(
        "Link",
        "</api/v1/citizens/lookup>; rel=\"successor-version\"",
      )
    }
    return response
  } catch (err) {
    console.error("[citizens] GET error:", err)
    return NextResponse.json({ error: "Failed to load citizens" }, { status: 500 })
  }
})

interface CreateBody {
  citizenNumber?: unknown
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
  contactId?: unknown
}

export const POST = withRlsAuth("public-sector", "write", async (req, auth) => {
  const orgId = auth.orgId

  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const citizenNumber = strField(body.citizenNumber, 64)
  if (!citizenNumber) {
    return NextResponse.json({ error: "`citizenNumber` is required" }, { status: 400 })
  }
  const fullName = strField(body.fullName, MAX_GENERIC_LEN)
  if (!fullName) {
    return NextResponse.json({ error: "`fullName` is required" }, { status: 400 })
  }

  let dob: Date | null = null
  if (body.dateOfBirth !== undefined && body.dateOfBirth !== null) {
    if (typeof body.dateOfBirth !== "string") {
      return NextResponse.json({ error: "Invalid `dateOfBirth`" }, { status: 400 })
    }
    const d = new Date(body.dateOfBirth)
    if (isNaN(d.getTime())) {
      return NextResponse.json({ error: "Invalid `dateOfBirth`" }, { status: 400 })
    }
    dob = d
  }

  try {
    // Slice-2 PII column wrap: encrypt PHI/PII columns at the route
    // boundary. Soft-decrypt on read tolerates legacy plaintext rows.
    // Non-encrypted passthrough: citizenNumber (institutional id),
    // email/phone (slice-3 hash-index wrap), dateOfBirth (typed Date),
    // jurisdictionSlug (analytics dimension), contactId (FK).
    // Compute plaintext taxId once so we can both encrypt it and
    // derive the blind index from the same source. `strField` returns
    // null when the body field is absent or empty.
    const plainTaxId = strField(body.taxId, 64)
    const citizen = await prisma.citizen.create({
      data: {
        organizationId: orgId,
        citizenNumber,
        fullName: encryptForTenantBound(orgId, TABLE, "fullName", fullName),
        // Slice-3: blind index alongside the ciphertext so the
        // GET-list `?fullName=` filter can find this row without
        // decrypting + scanning the whole tenant.
        fullNameBlindIndex: blindIndexForTenant(orgId, fullName),
        email: strField(body.email),
        phone: strField(body.phone, 32),
        dateOfBirth: dob,
        taxId: encryptForTenantBoundOrNull(orgId, TABLE, "taxId", plainTaxId),
        // Slice-3 ext: blind index for taxId. Null when no taxId was
        // supplied — both columns either populate together or stay
        // NULL together.
        taxIdBlindIndex: blindIndexForTenant(orgId, plainTaxId),
        addressLine1: encryptForTenantBoundOrNull(
          orgId,
          TABLE,
          "addressLine1",
          strField(body.addressLine1),
        ),
        addressLine2: encryptForTenantBoundOrNull(
          orgId,
          TABLE,
          "addressLine2",
          strField(body.addressLine2),
        ),
        city: encryptForTenantBoundOrNull(orgId, TABLE, "city", strField(body.city, 100)),
        stateProvince: encryptForTenantBoundOrNull(
          orgId,
          TABLE,
          "stateProvince",
          strField(body.stateProvince, 64),
        ),
        postalCode: encryptForTenantBoundOrNull(
          orgId,
          TABLE,
          "postalCode",
          strField(body.postalCode, 32),
        ),
        country: encryptForTenantBoundOrNull(
          orgId,
          TABLE,
          "country",
          strField(body.country, 64),
        ),
        jurisdictionSlug: strField(body.jurisdictionSlug, 64),
        contactId: strField(body.contactId, 64),
      },
      select: {
        id: true,
        citizenNumber: true,
        fullName: true,
        status: true,
        jurisdictionSlug: true,
        createdAt: true,
      },
    })

    void recordFoiaAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: citizen.id,
      action: "write",
      metadata: { citizenNumber: citizen.citizenNumber },
    })

    return NextResponse.json(
      {
        citizen: {
          ...citizen,
          fullName: softDecryptForTenantBound(orgId, TABLE, "fullName", citizen.fullName),
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
        { error: "A citizen with this `citizenNumber` already exists" },
        { status: 409 },
      )
    }
    console.error("[citizens] POST error:", err)
    return NextResponse.json({ error: "Failed to create citizen" }, { status: 500 })
  }
})
