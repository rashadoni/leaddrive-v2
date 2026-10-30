/**
 * The v1 → v2 sweep of PII columns: re-encrypt values written under the
 * HKDF-derived tenant key with the organization's stored data key
 * (`tenant-data-keys.ts`), and count what is left per organization.
 *
 * Every value keeps its AAD (`reencryptForTenantDataKey`): column-bound when
 * it verifies under `${orgId}|${table}|${column}`, orgId-only otherwise. A row
 * is rewritten only if it still holds the value that was read
 * (`… WHERE id = $ AND "<column>" = $old`), so a route that saved the row in
 * between wins. Raw SQL on purpose: Prisma would bump `updatedAt`, and a
 * re-encryption is not a change anyone made to the record.
 *
 * What counts as "v1": a value that is not `vN:`-prefixed, is base64 and is
 * long enough to hold IV + tag + one byte (≥ 40 characters). The count is a
 * SQL estimate — a long base64-looking plaintext would be counted too; the
 * sweep itself only rewrites what actually decrypts, and reports the rest as
 * `undecryptable`.
 *
 * Callers run this under `runWithRlsBypass`: it reads every organization.
 */
import { prisma } from "@/lib/prisma"
import { ensureTenantDataKeys } from "@/lib/crypto/tenant-data-keys"
import { reencryptForTenantDataKey } from "@/lib/crypto/tenant-pii-encryption"

/**
 * Encrypted PII columns, by physical table. Same inventory as
 * `scripts/lint-encrypted-columns.mjs` plus the columns encrypted outside the
 * 19 routes; `tenant-data-key-reencrypt.test.ts` checks each against the schema.
 */
export const REENCRYPTABLE_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  health_patients: [
    "fullName", "sexAtBirth", "taxId", "addressLine1", "city", "postalCode", "country",
    "insuranceCarrier", "insurancePolicyId", "emergencyContactName", "emergencyContactPhone",
  ],
  health_encounters: ["reason", "location", "cancellationReason"],
  health_care_plans: ["description", "cancellationReason"],
  health_providers: ["fullName"],
  policy_holders: ["fullName", "taxId", "mailingAddressLine1", "mailingCity", "mailingPostalCode", "mailingCountry"],
  policies: ["cancellationReason"],
  claims: ["description", "decisionRationale"],
  beneficiaries: ["fullName", "relationship", "taxId", "revocationReason"],
  insurance_service_team_members: ["fullName"],
  citizens: ["fullName", "taxId", "addressLine1", "addressLine2", "city", "stateProvince", "postalCode", "country"],
  public_sector_cases: ["description", "decisionRationale", "withdrawalReason"],
  public_sector_licenses: ["decisionRationale"],
  public_sector_grants: ["narrative", "decisionRationale", "terminationReason"],
  public_sector_officials: ["fullName"],
  media_subscribers: ["displayName"],
  utility_customers: [
    "accountHolderName", "serviceAddressLine1", "serviceAddressLine2", "serviceCity", "servicePostalCode", "serviceCountry",
  ],
  service_calls: ["subject", "description", "resolutionNotes", "cancellationReason"],
  outages: ["publicSummary", "internalNotes"],
  quotes: ["rejectedReason"],
  esign_provider_configs: ["config"],
  pharmacy_phone_orders: ["callerPhone"],
}

/**
 * Encrypted columns of tables whose rows a trigger forbids rewriting. Their v1
 * values stay readable under the derived key and are counted separately: the
 * owner should know they are not covered by destroying a data key.
 *   • health_medical_records — append-only (`health_medical_records_no_update_trigger`).
 *   • workforce_attendance_evidence — immutable except the expiry purge,
 *     which deletes the raw ciphertext anyway.
 */
export const APPEND_ONLY_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  health_medical_records: ["clinicianNotes"],
  workforce_attendance_evidence: ["rawEnvelopeCiphertext"],
}

const V1_SHAPE = (column: string) =>
  `"${column}" IS NOT NULL AND "${column}" !~ '^v[2-9]:' AND length("${column}") >= 40 AND "${column}" ~ '^[A-Za-z0-9+/]+=*$'`

const PAGE_ROWS = 200

export type ColumnSweepCounts = {
  scanned: number
  rewritten: number
  /** Base64-shaped values that open under neither AAD (plaintext, another tenant's). */
  undecryptable: number
  /** Rows whose organization's data key could not be loaded. */
  keyUnavailable: number
  /** Rows changed by someone else between read and write. */
  changedMeanwhile: number
}

export function emptyColumnSweepCounts(): ColumnSweepCounts {
  return { scanned: 0, rewritten: 0, undecryptable: 0, keyUnavailable: 0, changedMeanwhile: 0 }
}

/**
 * Re-encrypt up to `limit` v1 values to v2, loading (and, for an organization
 * that has none yet, creating) each organization's data key on the way.
 * Returns `hasMore` when the budget ran out before every candidate was seen.
 */
export async function reencryptTenantColumns(options: { limit: number }): Promise<{
  hasMore: boolean
  counts: ColumnSweepCounts
}> {
  const counts = emptyColumnSweepCounts()
  let budget = options.limit
  for (const [table, columns] of Object.entries(REENCRYPTABLE_COLUMNS)) {
    for (const column of columns) {
      let after = ""
      for (;;) {
        const rows: Array<{ id: string; organizationId: string; value: string }> = await prisma.$queryRawUnsafe(
          `SELECT id, "organizationId", "${column}" AS value FROM "${table}"
            WHERE ${V1_SHAPE(column)} AND id > $1
            ORDER BY id ASC LIMIT ${PAGE_ROWS}`,
          after,
        )
        if (rows.length === 0) break
        for (const row of rows) {
          after = row.id
          counts.scanned += 1
          if (budget <= 0) return { hasMore: true, counts }
          try {
            await ensureTenantDataKeys(row.organizationId)
          } catch {
            counts.keyUnavailable += 1
            continue
          }
          const next = reencryptForTenantDataKey(row.organizationId, table, column, row.value)
          if (next === null) {
            counts.undecryptable += 1
            continue
          }
          budget -= 1
          const changed: number = await prisma.$executeRawUnsafe(
            `UPDATE "${table}" SET "${column}" = $1 WHERE id = $2 AND "organizationId" = $3 AND "${column}" = $4`,
            next,
            row.id,
            row.organizationId,
            row.value,
          )
          if (changed === 1) counts.rewritten += 1
          else counts.changedMeanwhile += 1
        }
        if (rows.length < PAGE_ROWS) break
      }
    }
  }
  return { hasMore: false, counts }
}

async function countByOrganization(
  registry: Readonly<Record<string, readonly string[]>>,
): Promise<Map<string, number>> {
  const byOrg = new Map<string, number>()
  for (const [table, columns] of Object.entries(registry)) {
    for (const column of columns) {
      const rows: Array<{ organizationId: string; n: bigint | number }> = await prisma.$queryRawUnsafe(
        `SELECT "organizationId", count(*) AS n FROM "${table}" WHERE ${V1_SHAPE(column)} GROUP BY "organizationId"`,
      )
      for (const row of rows) byOrg.set(row.organizationId, (byOrg.get(row.organizationId) ?? 0) + Number(row.n))
    }
  }
  return byOrg
}

/** v1 values left per organization: rewritable, and in append-only tables. */
export async function countV1ColumnValues(): Promise<{ rewritable: Map<string, number>; appendOnly: Map<string, number> }> {
  return {
    rewritable: await countByOrganization(REENCRYPTABLE_COLUMNS),
    appendOnly: await countByOrganization(APPEND_ONLY_COLUMNS),
  }
}
