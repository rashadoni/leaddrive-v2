/**
 * Slice-3 blind-index backfill.
 *
 * Each slice-3 wiring PR adds a nullable `<col>BlindIndex` column on a
 * table (citizens.fullNameBlindIndex, health_patients.fullNameBlindIndex,
 * policy_holders.fullNameBlindIndex, beneficiaries.fullNameBlindIndex)
 * and writes the HMAC on POST + PATCH. Rows that pre-date the wiring
 * PR keep `NULL` in the index column, which means the `?fullName=`
 * equality filter silently returns zero hits for legacy data.
 *
 * This helper walks legacy rows (`fullNameBlindIndex IS NULL`) in
 * deterministic batches, soft-decrypts the fullName ciphertext,
 * computes the blind index, and writes it back via raw SQL.
 *
 * Why raw SQL:
 *   • The four entity-schema PRs (#160, #161, #162, #163) are sibling
 *     PRs stacked on the helper PR (#159) — at compile time on the
 *     backfill branch, the Prisma client only knows about one of the
 *     four `fullNameBlindIndex` columns. Raw SQL bypasses the
 *     typed-accessor coupling and runs correctly against the deployed
 *     schema (which has all four columns once migrations finish).
 *   • Raw bulk updates are also cheaper than per-row typed accessors.
 *
 * Properties:
 *   • Idempotent — `WHERE "fullNameBlindIndex" IS NULL` filters out
 *     already-backfilled rows, so re-running is a no-op.
 *   • Restart-resumable — a mid-batch crash drops the in-flight
 *     update; the next run picks up from the same WHERE filter.
 *   • Bounded per-run — `maxRowsPerEntity` caps the work so the
 *     wrapping cron route stays inside Vercel's request budget.
 *   • Tenant-scoped — each row's `organizationId` drives the HMAC
 *     key, so cross-tenant key leakage is impossible by construction.
 *   • Tolerant of legacy plaintext — `softDecryptForTenant` returns
 *     the value unchanged when it cannot decrypt, which means we
 *     still get a usable plaintext to hash.
 *
 * What we DON'T do:
 *   • No row-level locking — concurrent writes from the route layer
 *     (POST/PATCH) also write the index inline, so the backfill only
 *     ever touches rows the route hasn't yet. Last-writer-wins is
 *     safe because both writers compute the same deterministic hash.
 */
import {
  blindIndexForTenant,
  softDecryptForTenant,
} from "./tenant-pii-encryption"

export type BackfillTable =
  | "citizens"
  | "health_patients"
  | "policy_holders"
  | "beneficiaries"

/** Slice-3 wired columns. Each entry is (plaintext column → blind-
 *  index column) on a specific table. The backfill iterates this
 *  list, so adding a new wired column means one entry here, not a
 *  separate helper. */
export type BackfillColumn = "fullName" | "taxId"

export interface BackfillEntityResult {
  /** Physical table name. */
  table: BackfillTable
  /** Which encrypted column this row describes. */
  column: BackfillColumn
  /** Rows fetched in this run before any updates. */
  scanned: number
  /** Rows for which a non-null blind index was computed and stored. */
  updated: number
  /** Rows skipped because decrypted plaintext was empty after
   *  normalization (extreme edge — explicit NULL columns shouldn't
   *  reach the WHERE filter, but defense in depth). */
  skippedEmpty: number
  /** Per-tenant breakdown of updated rows. The cron route uses this
   *  to write one compliance_audit_log entry per affected tenant
   *  (organizationId is required on that table — there is no
   *  system-tenant sentinel). */
  updatedByOrg: Record<string, number>
}

export interface BackfillResult {
  perEntity: BackfillEntityResult[]
  /** Sum of `updated` across the entity list. */
  totalUpdated: number
  /** True if at least one entity returned a full batch — caller
   *  should run the cron again soon to keep draining. */
  hasMore: boolean
}

/**
 * Minimal Prisma surface we depend on. Decoupled from the full
 * `PrismaClient` type so tests can pass a stub.
 */
export interface RawPrisma {
  $queryRawUnsafe<T = unknown>(query: string, ...params: unknown[]): Promise<T>
  $executeRawUnsafe(query: string, ...params: unknown[]): Promise<number>
}

interface LegacyRow {
  id: string
  organizationId: string
  /** The selected plaintext-or-ciphertext column value. Aliased via
   *  `SELECT "<col>" AS "plain"` so we don't have to template the
   *  column name into the row-deserialization site. */
  plain: string
}

const TABLES: BackfillTable[] = [
  "citizens",
  "health_patients",
  "policy_holders",
  "beneficiaries",
]

/** (plain column → blind-index column) pairs wired in slice-3.
 *  `fullName` landed in the original slice-3 stack; `taxId` landed
 *  in the slice-3 extension. Add new pairs here as more columns
 *  get blind-index wiring. */
const WIRED_COLUMNS: Array<{
  plainColumn: string
  indexColumn: string
  column: BackfillColumn
}> = [
  {
    plainColumn: "fullName",
    indexColumn: "fullNameBlindIndex",
    column: "fullName",
  },
  { plainColumn: "taxId", indexColumn: "taxIdBlindIndex", column: "taxId" },
]

/**
 * Run a single backfill pass.
 *
 * Each entity is processed independently — a transient failure on
 * one table doesn't block the others.
 */
export async function runBlindIndexBackfill(
  prisma: RawPrisma,
  opts?: { maxRowsPerEntity?: number },
): Promise<BackfillResult> {
  const limit = Math.max(1, Math.min(opts?.maxRowsPerEntity ?? 200, 1000))
  const perEntity: BackfillEntityResult[] = []
  let hasMore = false

  for (const table of TABLES) {
    for (const wired of WIRED_COLUMNS) {
      // Per-(table × column) try/catch: if one table's column doesn't
      // exist yet (e.g. its slice-3 wiring PR hasn't been deployed),
      // the failure is isolated — other (table × column) pairs still
      // drain. Same applies if the SELECT fails for any other reason.
      try {
        // Table + column names are constants from the
        // TABLES/WIRED_COLUMNS allow-lists; interpolation is safe.
        const sql = `
          SELECT id, "organizationId", "${wired.plainColumn}" AS "plain"
          FROM "${table}"
          WHERE "${wired.indexColumn}" IS NULL
            AND "${wired.plainColumn}" IS NOT NULL
          ORDER BY id ASC
          LIMIT $1
        `
        const rows = await prisma.$queryRawUnsafe<LegacyRow[]>(sql, limit)
        let updated = 0
        let skippedEmpty = 0
        const updatedByOrg: Record<string, number> = {}
        for (const row of rows) {
          const plaintext = softDecryptForTenant(
            row.organizationId,
            row.plain,
          )
          if (plaintext === null || plaintext.length === 0) {
            skippedEmpty++
            continue
          }
          const hash = blindIndexForTenant(row.organizationId, plaintext)
          if (hash === null) {
            skippedEmpty++
            continue
          }
          await prisma.$executeRawUnsafe(
            `UPDATE "${table}" SET "${wired.indexColumn}" = $1 WHERE id = $2`,
            hash,
            row.id,
          )
          updated++
          updatedByOrg[row.organizationId] =
            (updatedByOrg[row.organizationId] ?? 0) + 1
        }
        if (skippedEmpty > 0) {
          // Diagnostic signal — non-zero skippedEmpty means we have
          // rows with NULL plaintext (or post-normalization empty
          // strings) in a column that should usually be present.
          console.warn(
            `[blind-index-backfill] ${table}.${wired.plainColumn}: ${skippedEmpty} rows skipped (empty plaintext)`,
          )
        }
        perEntity.push({
          table,
          column: wired.column,
          scanned: rows.length,
          updated,
          skippedEmpty,
          updatedByOrg,
        })
        if (rows.length >= limit) hasMore = true
      } catch (err) {
        console.error(
          `[blind-index-backfill] ${table}.${wired.plainColumn} failed — skipping this column:`,
          err,
        )
        perEntity.push({
          table,
          column: wired.column,
          scanned: 0,
          updated: 0,
          skippedEmpty: 0,
          updatedByOrg: {},
        })
      }
    }
  }

  const totalUpdated = perEntity.reduce((s, e) => s + e.updated, 0)
  return { perEntity, totalUpdated, hasMore }
}
