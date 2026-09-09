/**
 * R2 Health — patient PII-safe lookup (slice-3 security ext).
 *
 * POST /api/v1/health-patients/lookup
 *
 * Accepts `fullName` and/or `taxId` in the **request body** rather
 * than URL query params, preventing plaintext PHI from appearing in
 * nginx access logs. Payer-record cross-reference (taxId → patient)
 * is the common HIPAA-authorized lookup use case.
 *
 * At least one of `fullName` or `taxId` must be provided.
 *
 * Response shape is identical to GET /api/v1/health-patients.
 *
 * Auth: `health:read` — same as GET /api/v1/health-patients.
 * Audit: one PHI compliance_audit_log row per call,
 *   `metadata.lookup: true` as HIPAA forensic discriminator.
 *   Cursor value is NOT logged (logged as `cursorPresent: bool` only).
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { recordPhiAccessFromRequest } from "@/lib/audit/compliance-audit"
import { withRlsAuth } from "@/lib/with-rls"
import {
  blindIndexForTenant,
  softDecryptForTenantBound,
} from "@/lib/crypto/tenant-pii-encryption"
import { strField, parseLimit } from "@/lib/api/pii-lookup-utils"

// Phase 7 slice-3 migration (2026-05-29): column-bound AAD on read.
const TABLE = "health_patients"

interface LookupBody {
  fullName?: unknown
  taxId?: unknown
  status?: unknown
  search?: unknown
  limit?: unknown
  cursor?: unknown
}

export const POST = withRlsAuth("health", "read", async (req: NextRequest, auth) => {
  const orgId = auth.orgId

  let body: LookupBody
  try {
    body = (await req.json()) as LookupBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const fullNameFilter = strField(body.fullName)
  const taxIdFilter = strField(body.taxId, 64)

  if (!fullNameFilter && !taxIdFilter) {
    return NextResponse.json(
      {
        error:
          "At least one of `fullName` or `taxId` is required. " +
          "For an un-filtered list use GET /api/v1/health-patients.",
      },
      { status: 400 },
    )
  }

  const limit = parseLimit(body.limit)
  const cursor = strField(body.cursor, 256)
  const status = strField(body.status, 64)
  const search = strField(body.search)

  const where: {
    organizationId: string
    status?: string
    fullNameBlindIndex?: string
    taxIdBlindIndex?: string
    OR?: Array<Record<string, { contains: string; mode: "insensitive" }>>
  } = { organizationId: orgId }

  if (status) where.status = status

  if (fullNameFilter) {
    const hash = blindIndexForTenant(orgId, fullNameFilter)
    if (hash) where.fullNameBlindIndex = hash
  }
  if (taxIdFilter) {
    const hash = blindIndexForTenant(orgId, taxIdFilter)
    if (hash) where.taxIdBlindIndex = hash
  }

  // Legacy token search on non-PHI columns (mrn + email).
  if (search) {
    where.OR = [
      { mrn: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ]
  }

  try {
    const patients = await prisma.healthPatient.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit + 1,
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
    const rows = rawRows.map(
      (p: { fullName: string } & Record<string, unknown>) => ({
        ...p,
        fullName: softDecryptForTenantBound(orgId, TABLE, "fullName", p.fullName),
      }),
    )
    const nextCursor = hasMore ? (rows[rows.length - 1].id as string) : null

    void recordPhiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: null,
      action: "read",
      metadata: {
        lookup: true,
        limit,
        cursorPresent: cursor !== null,
        status: status ?? null,
        searchHit: search !== null,
        fullNameFilterHit: fullNameFilter !== null,
        taxIdFilterHit: taxIdFilter !== null,
        rowCount: rows.length,
      },
    })

    return NextResponse.json({ patients: rows, hasMore, nextCursor })
  } catch (err) {
    console.error("[health-patients/lookup] POST error:", err)
    return NextResponse.json(
      { error: "Failed to look up patients" },
      { status: 500 },
    )
  }
})
