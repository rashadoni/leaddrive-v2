import { assertIdentityScope } from "./contract"
import type { LegacyCredentialBoundary } from "./legacy-credential-boundary"

/** The caller's client inside `runWithTenant(organizationId)`: the RLS wrapper sets `app.org_id` for the statement. */
export type LegacyBoundaryClient = { $queryRaw: <T = unknown>(query: TemplateStringsArray, ...values: unknown[]) => Promise<T> }

type BoundaryRow = {
  contextOrg: string | null
  bypass: string | null
  companyId: string | null
  companyActive: boolean | null
  personId: string | null
  personOrg: string | null
  role: string | null
  personActive: boolean | null
  anonymizedAt: Date | null
  hasAccount: boolean
  cutoverAt: Date | null
}

/**
 * Legacy CRM eligibility only, NOT password/MFA authentication. Preserve the
 * existing platform exception using fresh DB role, never a cookie/body role.
 * Canonical authority refuses old password/cookie admission even with rollout
 * off, missing grants, or a malformed converted platform account. No fallback.
 *
 * One statement, not a transaction (2026-11-12). This runs on EVERY signed-in request — twice, from
 * the proxy and from the route — and as a REPEATABLE READ interactive transaction of eight
 * statements it cost ~63 ms each on prod for ~1 ms of database work (owner: «сайт сам долго загружает
 * страницы»). A single SELECT sees one snapshot by itself, so reading the company, the person and
 * the identity account together is exactly as consistent; the tenant guard the transaction made
 * (`app.org_id` is this tenant, bypass is off) is read in the same statement and still fails closed.
 */
export async function readLegacyCrmCredentialBoundary(client: LegacyBoundaryClient, organizationId: string,
  userId: string): Promise<LegacyCredentialBoundary> {
  try {
    assertIdentityScope(organizationId, userId)
    const [row] = await client.$queryRaw<BoundaryRow[]>`
      SELECT current_setting('app.org_id', true) AS "contextOrg",
             coalesce(nullif(current_setting('app.rls_bypass', true), ''), 'off') AS bypass,
             o.id AS "companyId", o."isActive" AS "companyActive",
             u.id AS "personId", u."organizationId" AS "personOrg", u.role, u."isActive" AS "personActive", u."anonymizedAt",
             (a."userId" IS NOT NULL) AS "hasAccount", a."cutoverAt"
        FROM (SELECT 1) AS one
        LEFT JOIN organizations o ON o.id = ${organizationId}
        LEFT JOIN users u ON u.id = ${userId} AND u."organizationId" = ${organizationId}
        LEFT JOIN identity_accounts a ON a."organizationId" = ${organizationId} AND a."userId" = ${userId}`
    if (!row || row.contextOrg !== organizationId || row.bypass !== "off") return "UNAVAILABLE"
    if (row.hasAccount && row.cutoverAt !== null) return "MIGRATED"
    if (row.companyId !== organizationId || row.personId !== userId || row.personOrg !== organizationId
      || row.personActive !== true || row.anonymizedAt !== null
      || (row.companyActive !== true && row.role !== "superadmin")) return "UNAVAILABLE"
    return "LEGACY"
  } catch { return "UNAVAILABLE" }
}
