/**
 * R8 Public Sector — citizen PII-safe lookup (slice-3 security ext).
 *
 * POST /api/v1/citizens/lookup
 *
 * Accepts `fullName` and/or `taxId` in the **request body** rather
 * than URL query params, preventing plaintext SSN / full-name from
 * appearing in nginx access logs (combined log format records the full
 * request URI including query string).
 *
 * At least one of `fullName` or `taxId` must be provided; the endpoint
 * returns 400 otherwise (callers that need an un-filtered list should
 * use GET /api/v1/citizens with no PII params).
 *
 * Both fields are resolved to their per-tenant blind-index HMAC before
 * any DB call — plaintext never reaches a log sink.
 *
 * Response shape is intentionally identical to GET /api/v1/citizens so
 * existing clients need no response-parsing changes when migrating.
 *
 * Auth: `public-sector:read` — same as GET /api/v1/citizens.
 * Audit: one FOIA compliance_audit_log row per call, with
 *   `metadata.lookup: true` as a forensic discriminator.
 *   Cursor value is NOT logged (logged as `cursorPresent: bool` only).
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordFoiaAccessFromRequest } from "@/lib/audit/compliance-audit"
import {
  blindIndexForTenant,
  softDecryptForTenantBound,
} from "@/lib/crypto/tenant-pii-encryption"
// Phase 7 slice-3 migration (2026-05-29): column-bound AAD on read.
import { strField, parseLimit } from "@/lib/api/pii-lookup-utils"

const TABLE = "citizens"

interface LookupBody {
  fullName?: unknown
  taxId?: unknown
  status?: unknown
  jurisdictionSlug?: unknown
  search?: unknown
  limit?: unknown
  cursor?: unknown
}

export const POST = withRlsAuth("public-sector", "read", async (req, auth) => {
  const orgId = auth.orgId

  let body: LookupBody
  try {
    body = (await req.json()) as LookupBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const fullNameFilter = strField(body.fullName)
  const taxIdFilter = strField(body.taxId, 64)

  // At least one PII filter must be present — callers that need a full
  // un-filtered list should use GET /api/v1/citizens.
  if (!fullNameFilter && !taxIdFilter) {
    return NextResponse.json(
      {
        error:
          "At least one of `fullName` or `taxId` is required. " +
          "For an un-filtered list use GET /api/v1/citizens.",
      },
      { status: 400 },
    )
  }

  const limit = parseLimit(body.limit)
  const cursor = strField(body.cursor, 256)
  const status = strField(body.status, 64)
  const jurisdictionSlug = strField(body.jurisdictionSlug, 64)
  const search = strField(body.search)

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

  // Resolve each PII filter to its per-tenant blind-index hash.
  // `blindIndexForTenant` normalises (NFKC + lowercase + trim) before
  // hashing, so "  123-45-6789  " and "123-45-6789" map to the same hash.
  if (fullNameFilter) {
    const hash = blindIndexForTenant(orgId, fullNameFilter)
    if (hash) where.fullNameBlindIndex = hash
  }
  if (taxIdFilter) {
    const hash = blindIndexForTenant(orgId, taxIdFilter)
    if (hash) where.taxIdBlindIndex = hash
  }

  // Legacy token search on non-PII columns (citizenNumber + email).
  if (search) {
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

    // FOIA audit — `lookup: true` lets forensic queries distinguish
    // "user searched by SSN via POST lookup" from "user listed all
    // citizens via GET". Plaintext PII values are never written to the
    // log; cursor value is omitted in favour of `cursorPresent`.
    void recordFoiaAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: null,
      action: "read",
      metadata: {
        lookup: true,
        limit,
        cursorPresent: cursor !== null,
        status: status ?? null,
        jurisdictionSlug: jurisdictionSlug ?? null,
        searchHit: search !== null,
        fullNameFilterHit: fullNameFilter !== null,
        taxIdFilterHit: taxIdFilter !== null,
        rowCount: rows.length,
      },
    })

    return NextResponse.json({ citizens: rows, hasMore, nextCursor })
  } catch (err) {
    console.error("[citizens/lookup] POST error:", err)
    return NextResponse.json(
      { error: "Failed to look up citizens" },
      { status: 500 },
    )
  }
})
