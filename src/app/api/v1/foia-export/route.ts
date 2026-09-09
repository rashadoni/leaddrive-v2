/**
 * R8 Public Sector — FOIA records-request export.
 *
 * Endpoint:
 *   GET /api/v1/foia-export?citizenId=<id>&from=<ISO>&to=<ISO>
 *
 * Returns: all records for the specified citizen across cases /
 * licenses / grants, PLUS all `compliance_audit_log` entries for
 * those records, within the given date window.
 *
 * Use case (real-world): a citizen invokes their FOIA right ("show
 * me everything you have about me, and who looked at it"). Operators
 * pass the citizen's id + the date range; this endpoint produces the
 * complete record bundle the agency must hand over.
 *
 * Self-auditing: the export itself logs to `compliance_audit_log`
 * with `action: 'export'`. That row IS visible in subsequent FOIA
 * exports — recursion is intentional; the citizen can see the entire
 * history of who exported their record.
 *
 * Scope:
 *   • Citizen row + decrypted PII fields
 *   • All PublicSectorCase rows where citizenId matches
 *   • All PublicSectorLicense rows where citizenId matches
 *   • All PublicSectorGrant rows where citizenId matches
 *   • compliance_audit_log rows where recordTable matches any of
 *     {citizens, public_sector_cases, public_sector_licenses,
 *      public_sector_grants} AND recordId matches one of the above
 *
 * Not in scope (slice-3 follow-ups):
 *   • PDF rendering — JSON output only today
 *   • Async / streaming — synchronous response capped at MAX_AUDIT_ROWS
 *   • Cross-tenant lookup — citizen ids are tenant-scoped here
 *   • Encrypted-at-rest export — JSON is plaintext on the wire (TLS
 *     in transit + operator-side handling per agency policy)
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { recordFoiaAccessFromRequest } from "@/lib/audit/compliance-audit"
import { softDecryptForTenant } from "@/lib/crypto/tenant-pii-encryption"
import { withRlsAuth } from "@/lib/with-rls"

// Synchronous-export safety bound. Agencies with deeper case-load
// histories should switch to async / streaming exports — flagged
// in the response as `bounded: true`.
const MAX_AUDIT_ROWS = 5000

export const GET = withRlsAuth("public-sector", "read", async (req, auth) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const citizenId = searchParams.get("citizenId")
  const fromRaw = searchParams.get("from")
  const toRaw = searchParams.get("to")

  if (!citizenId) {
    return NextResponse.json(
      { error: "`citizenId` is required" },
      { status: 400 },
    )
  }

  let from: Date | null = null
  let to: Date | null = null
  if (fromRaw) {
    const d = new Date(fromRaw)
    if (isNaN(d.getTime())) {
      return NextResponse.json({ error: "Invalid `from`" }, { status: 400 })
    }
    from = d
  }
  if (toRaw) {
    const d = new Date(toRaw)
    if (isNaN(d.getTime())) {
      return NextResponse.json({ error: "Invalid `to`" }, { status: 400 })
    }
    to = d
  }
  if (from && to && to.getTime() <= from.getTime()) {
    return NextResponse.json(
      { error: "`to` must be after `from`" },
      { status: 400 },
    )
  }

  try {
    // Tenant-scoped citizen lookup. 404 if the id doesn't belong to
    // the caller's org — FOIA records-request can't reach across
    // tenant boundaries.
    const citizen = await prisma.citizen.findFirst({
      where: { id: citizenId, organizationId: orgId },
    })
    if (!citizen) {
      void recordFoiaAccessFromRequest(req, auth, {
        recordTable: "citizens",
        recordId: citizenId,
        action: "export",
        metadata: { result: "not_found", from: fromRaw, to: toRaw },
      })
      return NextResponse.json(
        { error: "Citizen not found" },
        { status: 404 },
      )
    }

    // Parallel-fetch all child records.
    const dateFilter: { gte?: Date; lte?: Date } = {}
    if (from) dateFilter.gte = from
    if (to) dateFilter.lte = to
    const withWindow = (col: string) =>
      from || to
        ? { [col]: dateFilter }
        : {}

    const [cases, licenses, grants] = await Promise.all([
      prisma.publicSectorCase.findMany({
        where: {
          citizenId,
          organizationId: orgId,
          ...withWindow("submittedAt"),
        },
        orderBy: { submittedAt: "asc" },
      }),
      prisma.publicSectorLicense.findMany({
        where: {
          citizenId,
          organizationId: orgId,
          ...withWindow("appliedAt"),
        },
        orderBy: { appliedAt: "asc" },
      }),
      prisma.publicSectorGrant.findMany({
        where: {
          citizenId,
          organizationId: orgId,
          ...withWindow("submittedAt"),
        },
        orderBy: { submittedAt: "asc" },
      }),
    ])

    // Collect record IDs for audit-log lookup.
    const caseIds = cases.map(
      (c: { id: string }) => c.id,
    ) as string[]
    const licenseIds = licenses.map(
      (l: { id: string }) => l.id,
    ) as string[]
    const grantIds = grants.map(
      (g: { id: string }) => g.id,
    ) as string[]

    // Audit-log entries for citizen + all child records.
    const auditWhere: {
      organizationId: string
      recordTable: { in: string[] }
      recordType: { in: string[] }
      occurredAt?: { gte?: Date; lte?: Date }
      OR?: Array<
        | { recordTable: string; recordId: { in: string[] } }
        | { recordTable: string; recordId: string }
      >
    } = {
      organizationId: orgId,
      recordTable: {
        in: [
          "citizens",
          "public_sector_cases",
          "public_sector_licenses",
          "public_sector_grants",
        ],
      },
      recordType: { in: ["foia", "pii", "phi"] },
    }
    if (from || to) {
      const r: { gte?: Date; lte?: Date } = {}
      if (from) r.gte = from
      if (to) r.lte = to
      auditWhere.occurredAt = r
    }
    auditWhere.OR = [
      { recordTable: "citizens", recordId: citizen.id },
      { recordTable: "public_sector_cases", recordId: { in: caseIds } },
      {
        recordTable: "public_sector_licenses",
        recordId: { in: licenseIds },
      },
      { recordTable: "public_sector_grants", recordId: { in: grantIds } },
    ]

    const auditRows = await prisma.complianceAuditLog.findMany({
      where: auditWhere,
      orderBy: { occurredAt: "asc" },
      take: MAX_AUDIT_ROWS + 1,
    })
    const auditBounded = auditRows.length > MAX_AUDIT_ROWS
    const audits = auditBounded
      ? auditRows.slice(0, MAX_AUDIT_ROWS)
      : auditRows

    // Self-log the export itself. This row is the topmost audit
    // entry that the NEXT FOIA-export will include for this citizen.
    void recordFoiaAccessFromRequest(req, auth, {
      recordTable: "citizens",
      recordId: citizen.id,
      action: "export",
      metadata: {
        from: from?.toISOString() ?? null,
        to: to?.toISOString() ?? null,
        caseCount: cases.length,
        licenseCount: licenses.length,
        grantCount: grants.length,
        auditRowCount: audits.length,
        bounded: auditBounded,
      },
    })

    // Decrypt PII columns on every returned row before responding.
    // Citizens table: fullName, taxId, addressLine1, addressLine2,
    // city, stateProvince, postalCode, country.
    const decryptedCitizen = {
      ...citizen,
      fullName: softDecryptForTenant(orgId, citizen.fullName),
      taxId: softDecryptForTenant(orgId, citizen.taxId),
      addressLine1: softDecryptForTenant(orgId, citizen.addressLine1),
      addressLine2: softDecryptForTenant(orgId, citizen.addressLine2),
      city: softDecryptForTenant(orgId, citizen.city),
      stateProvince: softDecryptForTenant(orgId, citizen.stateProvince),
      postalCode: softDecryptForTenant(orgId, citizen.postalCode),
      country: softDecryptForTenant(orgId, citizen.country),
    }
    const decryptedCases = cases.map(
      (c: {
        description: string | null
        decisionRationale: string | null
        withdrawalReason: string | null
      } & Record<string, unknown>) => ({
        ...c,
        description: softDecryptForTenant(orgId, c.description),
        decisionRationale: softDecryptForTenant(orgId, c.decisionRationale),
        withdrawalReason: softDecryptForTenant(orgId, c.withdrawalReason),
      }),
    )
    const decryptedLicenses = licenses.map(
      (l: { decisionRationale: string | null } & Record<string, unknown>) => ({
        ...l,
        decisionRationale: softDecryptForTenant(orgId, l.decisionRationale),
      }),
    )
    const decryptedGrants = grants.map(
      (g: {
        narrative: string | null
        decisionRationale: string | null
        terminationReason: string | null
      } & Record<string, unknown>) => ({
        ...g,
        narrative: softDecryptForTenant(orgId, g.narrative),
        decisionRationale: softDecryptForTenant(orgId, g.decisionRationale),
        terminationReason: softDecryptForTenant(orgId, g.terminationReason),
      }),
    )

    return NextResponse.json({
      export: {
        generatedAt: new Date().toISOString(),
        window: {
          from: from?.toISOString() ?? null,
          to: to?.toISOString() ?? null,
        },
        citizen: decryptedCitizen,
        cases: decryptedCases,
        licenses: decryptedLicenses,
        grants: decryptedGrants,
        audits,
        bounded: auditBounded,
        boundLimit: auditBounded ? MAX_AUDIT_ROWS : null,
      },
    })
  } catch (err) {
    console.error("[foia-export] GET error:", err)
    return NextResponse.json(
      { error: "Failed to generate FOIA export" },
      { status: 500 },
    )
  }
})
