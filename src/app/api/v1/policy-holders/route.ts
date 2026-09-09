/**
 * R7 Insurance — policy-holder roster / create (slice-2-mini).
 *
 * Mirrors PR #93 R2 health-patients pattern. Real route-layer
 * consumer of `recordPiiAccessFromRequest` (PII audit, state DOI /
 * regulatory compliance).
 *
 * PII encryption: slice-3 column-bound AAD wrap. POST encrypts
 * `fullName` (required, AES-256-GCM with AAD = orgId+TABLE+column),
 * `taxId`, and all four `mailing*` columns via
 * `encryptForTenantBound`/`encryptForTenantBoundOrNull`; both
 * `fullName` and `taxId` also stamp a per-tenant HMAC blind-index for
 * equality search. The list GET soft-decrypts `fullName` via
 * `softDecryptForTenantBound` (bound → legacy → plaintext fallback so
 * slice-2 ciphertext + pre-wrap plaintext rows keep working). Slice-3
 * deferrals (email, phone, dateOfBirth) are called out in the POST
 * handler comment below.
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordPiiAccessFromRequest } from "@/lib/audit/compliance-audit"
import {
  blindIndexForTenant,
  encryptForTenantBound,
  encryptForTenantBoundOrNull,
  softDecryptForTenantBound,
} from "@/lib/crypto/tenant-pii-encryption"
import { HOLDER_STATUSES, type HolderStatus } from "@/lib/insurance/types"

// Phase 7 slice-3 migration (2026-05-29): wired to column-bound AAD
// helpers. AAD binds to (orgId, TABLE, "<column>"), preventing
// same-tenant cross-column ciphertext shuffle. Soft-decrypt fallback
// inside `softDecryptForTenantBound` (bound → legacy → plaintext)
// handles slice-2 ciphertext + pre-wrap plaintext rows during rollout.
const TABLE = "policy_holders"
const MAX_PAGE_SIZE = 200
const MAX_GENERIC_LEN = 200

function strField(v: unknown, max: number = MAX_GENERIC_LEN): string | null {
  if (typeof v !== "string") return null
  const trimmed = v.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

export const GET = withRlsAuth("insurance", "read", async (req, auth) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const limitRaw = searchParams.get("limit")
  const cursor = searchParams.get("cursor")
  const status = searchParams.get("status")
  const search = searchParams.get("search")
  // Slice-3 blind-index filter — same shape as citizens (PR #160).
  const fullNameFilter = searchParams.get("fullName")
  // Slice-3 ext: same shape for ?taxId=. State DOI / NAIC records-
  // request workflows often query by SSN.
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
  // Slice-3 (restored): exact-match search on encrypted fullName.
  if (fullNameFilter && fullNameFilter.trim().length > 0) {
    const hash = blindIndexForTenant(orgId, fullNameFilter)
    if (hash) where.fullNameBlindIndex = hash
  }
  if (taxIdFilter && taxIdFilter.trim().length > 0) {
    const hash = blindIndexForTenant(orgId, taxIdFilter)
    if (hash) where.taxIdBlindIndex = hash
  }
  // Legacy `?search=` still scans holderNumber + email.
  if (search && search.length > 0) {
    where.OR = [
      { holderNumber: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ]
  }

  try {
    const holders = await prisma.policyHolder.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        holderNumber: true,
        fullName: true,
        email: true,
        phone: true,
        status: true,
        activatedAt: true,
        createdAt: true,
      },
    })
    const hasMore = holders.length > limit
    const rawRows = hasMore ? holders.slice(0, limit) : holders
    // Soft-decrypt fullName for list rows.
    const rows = rawRows.map(
      (h: { fullName: string } & Record<string, unknown>) => ({
        ...h,
        fullName: softDecryptForTenantBound(orgId, TABLE, "fullName", h.fullName),
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
        status: status ?? null,
        searchHit: search !== null && search.length > 0,
        fullNameFilterHit:
          fullNameFilter !== null && fullNameFilter.trim().length > 0,
        taxIdFilterHit:
          taxIdFilter !== null && taxIdFilter.trim().length > 0,
        rowCount: rows.length,
      },
    })

    const response = NextResponse.json({ holders: rows, hasMore, nextCursor })
    // Deprecation signal (RFC 8594): plaintext PII in URL query params
    // is logged by nginx access log. Callers should migrate to
    // POST /api/v1/policy-holders/lookup which keeps PII in the body.
    if (
      (fullNameFilter && fullNameFilter.trim().length > 0) ||
      (taxIdFilter && taxIdFilter.trim().length > 0)
    ) {
      response.headers.set("Deprecation", "true")
      response.headers.set(
        "Link",
        "</api/v1/policy-holders/lookup>; rel=\"successor-version\"",
      )
    }
    return response
  } catch (err) {
    console.error("[policy-holders] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load policy holders" },
      { status: 500 },
    )
  }
})

interface CreateBody {
  holderNumber?: unknown
  fullName?: unknown
  status?: unknown
  email?: unknown
  phone?: unknown
  dateOfBirth?: unknown
  taxId?: unknown
  mailingAddressLine1?: unknown
  mailingCity?: unknown
  mailingPostalCode?: unknown
  mailingCountry?: unknown
  occupationSlug?: unknown
  contactId?: unknown
}

export const POST = withRlsAuth("insurance", "write", async (req, auth) => {
  const orgId = auth.orgId

  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const holderNumber = strField(body.holderNumber, 64)
  if (!holderNumber) {
    return NextResponse.json(
      { error: "`holderNumber` is required" },
      { status: 400 },
    )
  }
  const fullName = strField(body.fullName, MAX_GENERIC_LEN)
  if (!fullName) {
    return NextResponse.json(
      { error: "`fullName` is required" },
      { status: 400 },
    )
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

  // Validate status — default to "prospect" (the only status that does not
  // require activatedAt; all others trigger the active_coherence_check).
  const rawStatus = strField(body.status, 32)
  const status: HolderStatus =
    rawStatus && (HOLDER_STATUSES as readonly string[]).includes(rawStatus)
      ? (rawStatus as HolderStatus)
      : "prospect"

  // The DB CHECK constraints require:
  //   active | inactive | deceased → activatedAt IS NOT NULL
  //   inactive → deactivatedAt IS NOT NULL
  //   deceased → deceasedAt IS NOT NULL
  // Use a positive list (not "!== prospect") so any future pre-active
  // status added to HOLDER_STATUSES won't silently inherit activatedAt.
  const now = new Date()
  const needsActivatedAt: readonly HolderStatus[] = ["active", "inactive", "deceased"]
  const activatedAt   = needsActivatedAt.includes(status) ? now : null
  const deactivatedAt = status === "inactive" ? now : null
  const deceasedAt    = status === "deceased"  ? now : null

  // Compute plaintext taxId once so encryption + blind-index see the
  // same value. Both columns either populate together or stay NULL.
  const plainTaxId = strField(body.taxId, 64)

  try {
    // Slice-2 PII column wrap: encrypt PHI/PII columns at the route
    // boundary using per-tenant DEK + AES-256-GCM. Soft-decrypt on
    // reads (legacy plaintext rows pass through during rollout).
    // Non-encrypted passthrough: holderNumber (institutional id),
    // email/phone (slice-3 hash-index wrap), occupationSlug (analytics
    // dimension), contactId (FK), dateOfBirth (typed Date column —
    // schema-change scope for slice-3 wrap).
    const holder = await prisma.policyHolder.create({
      data: {
        organizationId: orgId,
        holderNumber,
        fullName: encryptForTenantBound(orgId, TABLE, "fullName", fullName),
        fullNameBlindIndex: blindIndexForTenant(orgId, fullName),
        status,
        activatedAt,
        deactivatedAt,
        deceasedAt,
        email: strField(body.email),
        phone: strField(body.phone, 32),
        dateOfBirth: dob,
        taxId: encryptForTenantBoundOrNull(orgId, TABLE, "taxId", plainTaxId),
        taxIdBlindIndex: blindIndexForTenant(orgId, plainTaxId),
        mailingAddressLine1: encryptForTenantBoundOrNull(
          orgId,
          TABLE,
          "mailingAddressLine1",
          strField(body.mailingAddressLine1),
        ),
        mailingCity: encryptForTenantBoundOrNull(
          orgId,
          TABLE,
          "mailingCity",
          strField(body.mailingCity, 100),
        ),
        mailingPostalCode: encryptForTenantBoundOrNull(
          orgId,
          TABLE,
          "mailingPostalCode",
          strField(body.mailingPostalCode, 32),
        ),
        mailingCountry: encryptForTenantBoundOrNull(
          orgId,
          TABLE,
          "mailingCountry",
          strField(body.mailingCountry, 64),
        ),
        occupationSlug: strField(body.occupationSlug, 64),
        contactId: strField(body.contactId, 64),
      },
      select: {
        id: true,
        holderNumber: true,
        fullName: true,
        status: true,
        createdAt: true,
      },
    })

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: holder.id,
      action: "write",
      metadata: { holderNumber: holder.holderNumber },
    })

    return NextResponse.json(
      {
        holder: {
          ...holder,
          fullName: softDecryptForTenantBound(orgId, TABLE, "fullName", holder.fullName),
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
        { error: "A policy holder with this `holderNumber` already exists" },
        { status: 409 },
      )
    }
    console.error("[policy-holders] POST error:", err)
    return NextResponse.json(
      { error: "Failed to create policy holder" },
      { status: 500 },
    )
  }
})
