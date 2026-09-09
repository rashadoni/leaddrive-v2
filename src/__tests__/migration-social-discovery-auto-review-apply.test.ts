import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(
  resolve(
    "prisma/migrations/20260723180000_social_discovery_auto_review_apply/migration.sql",
  ),
  "utf8",
)

const safeResolveMigration = readFileSync(
  resolve(
    "prisma/migrations/20260723230000_social_discovery_auto_review_safe_resolve/migration.sql",
  ),
  "utf8",
)

describe("social discovery auto-review apply migration", () => {
  it("persists a reject-only ledger and prevents concurrent active runs per subject", () => {
    expect(migration).toContain(
      `CHECK ("mode" IN ('REJECT_ONLY'))`,
    )
    expect(migration).toContain(
      `CREATE UNIQUE INDEX "discovery_auto_review_runs_active_subject_key"`,
    )
    expect(migration).toContain(
      `ON "discovery_auto_review_runs"("organizationId", "subjectId")`,
    )
    expect(migration).toContain(`WHERE "state" = 'APPLIED'`)
  })

  it("keeps a durable per-resolver decision tombstone after rollback", () => {
    expect(migration).toContain(
      `CREATE UNIQUE INDEX "discovery_auto_review_decisions_org_envelope_resolver_key"`,
    )
    expect(migration).toContain(
      `ON "discovery_auto_review_decisions"("organizationId", "envelopeId", "resolverVersion")`,
    )
    expect(migration).toContain(
      `CHECK ("state" IN ('SUPPRESSED', 'ROLLED_BACK', 'FINALIZED', 'SUPERSEDED'))`,
    )
  })

  it("rejects direct decision deletion, immutable updates, and decision truncation", () => {
    expect(migration).toContain(
      `CREATE TRIGGER discovery_auto_review_decisions_lifecycle_trigger`,
    )
    expect(migration).toContain(
      `BEFORE UPDATE OR DELETE ON "discovery_auto_review_decisions"`,
    )
    expect(migration).toContain(
      `discovery_auto_review_decisions is a durable tombstone ledger — DELETE rejected`,
    )
    expect(migration).toContain(
      `discovery_auto_review_decisions immutable fields cannot change`,
    )
    expect(migration).toContain(
      `CREATE TRIGGER discovery_auto_review_decisions_no_truncate_trigger`,
    )
    expect(migration).toContain(
      `BEFORE TRUNCATE ON "discovery_auto_review_decisions"`,
    )
    expect(migration).toContain(
      `discovery_auto_review_decisions is a durable tombstone ledger — TRUNCATE rejected`,
    )
  })

  it("enforces tenant RLS on runs, decisions, and immutable events", () => {
    for (const table of [
      "discovery_auto_review_runs",
      "discovery_auto_review_decisions",
      "discovery_auto_review_events",
    ]) {
      expect(migration).toContain(
        `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`,
      )
      expect(migration).toContain(
        `ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`,
      )
      expect(migration).toContain(
        `"organizationId" = current_setting('app.org_id', true)`,
      )
    }
    expect(migration).toContain(
      `BEFORE UPDATE OR DELETE ON "discovery_auto_review_events"`,
    )
    expect(migration).toContain(
      "discovery_auto_review_events is append-only",
    )
    expect(migration).toContain(
      `CREATE TRIGGER discovery_auto_review_events_no_truncate_trigger`,
    )
    expect(migration).toContain(
      `BEFORE TRUNCATE ON "discovery_auto_review_events"`,
    )
    expect(migration).toContain(
      `discovery_auto_review_events is append-only — TRUNCATE rejected`,
    )
  })

  it("rejects provider content, URLs, identities, and credentials from JSON evidence", () => {
    expect(migration).toContain(
      "social_discovery_auto_review_json_is_sanitized",
    )
    for (const normalizedSensitiveKey of [
      "'rawpayload'",
      "'providerpayload'",
      "'text'",
      "'authorname'",
      "'url'",
      "'canonicalurl'",
      "'accesstoken'",
      "'apikey'",
      "'authorization'",
      "'cookie'",
    ]) {
      expect(migration).toContain(normalizedSensitiveKey)
    }
    expect(migration).toContain(
      `social_discovery_auto_review_json_is_sanitized("evidence")`,
    )
    expect(migration).toContain(
      `social_discovery_auto_review_json_is_sanitized("payload")`,
    )
  })

  it("does not mutate source envelopes during schema deployment", () => {
    expect(migration).not.toMatch(/UPDATE\s+"ingest_envelopes"/u)
    expect(migration).not.toMatch(/DELETE\s+FROM\s+"ingest_envelopes"/u)
  })

  it("extends the durable ledger for provider-free safe resolution", () => {
    expect(safeResolveMigration).toContain(
      `CHECK ("mode" IN ('REJECT_ONLY', 'SAFE_RESOLVE'))`,
    )
    expect(safeResolveMigration).toContain(
      `CHECK ("action" IN ('REJECT', 'RELEASE_TO_NORMAL_PIPELINE'))`,
    )
    for (const aggregateKey of [
      "'rejectGroupCount'",
      "'rejectRowCount'",
      "'releaseGroupCount'",
      "'releaseRowCount'",
    ]) {
      expect(safeResolveMigration).toContain(aggregateKey)
    }
  })

  it("keeps the safe-resolve schema migration data-neutral", () => {
    expect(safeResolveMigration).not.toMatch(/UPDATE\s+"ingest_envelopes"/u)
    expect(safeResolveMigration).not.toMatch(/DELETE\s+FROM\s+"ingest_envelopes"/u)
    expect(safeResolveMigration).not.toMatch(/INSERT\s+INTO\s+"ingest_envelopes"/u)
  })
})
