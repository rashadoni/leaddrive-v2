#!/usr/bin/env node

import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { makeRlsTestPrisma } from "../_rls.mjs"

const adminUrl = process.env.EVENT_PLATFORM_TEST_DATABASE_URL
if (!adminUrl) throw new Error("EVENT_PLATFORM_TEST_DATABASE_URL is required")

function roleUrl(role, password) {
  const url = new URL(adminUrl)
  url.username = role
  url.password = password
  return url.toString()
}

function executeSql(url, sql, label) {
  const result = spawnSync(
    "node_modules/.bin/prisma",
    ["db", "execute", "--url", url, "--stdin"],
    { input: sql, encoding: "utf8", env: process.env },
  )
  if (result.status !== 0) {
    throw new Error(`${label} failed\n${result.stdout || ""}\n${result.stderr || ""}`)
  }
}

function executeFile(url, path) {
  executeSql(url, readFileSync(path, "utf8"), path)
}

function expectExecutionRejected(label, operation) {
  try {
    operation()
  } catch {
    return
  }
  throw new Error(`${label}: expected database rejection`)
}

async function expectRejected(label, operation) {
  try {
    await operation()
  } catch {
    return
  }
  throw new Error(`${label}: expected database rejection`)
}

const appUrl = roleUrl("event_app", "event-app-password")
const migratorUrl = roleUrl("event_migrator", "event-migrator-password")
const operatorUrl = roleUrl("effect_operator_jit", "effect-operator-password")

executeSql(adminUrl, `
  CREATE ROLE event_app LOGIN INHERIT NOSUPERUSER NOBYPASSRLS
    PASSWORD 'event-app-password';
  CREATE ROLE event_migrator LOGIN INHERIT NOSUPERUSER BYPASSRLS
    PASSWORD 'event-migrator-password';
  CREATE ROLE leaddrive_effect_operator NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
  CREATE ROLE effect_operator_jit LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS
    PASSWORD 'effect-operator-password';
  GRANT leaddrive_effect_operator TO effect_operator_jit;
  GRANT event_app TO event_migrator;
  GRANT CONNECT, CREATE ON DATABASE event_platform_test TO event_migrator;
  GRANT CONNECT ON DATABASE event_platform_test TO effect_operator_jit;
  GRANT USAGE, CREATE ON SCHEMA public TO event_app, event_migrator;
  GRANT USAGE ON SCHEMA public TO leaddrive_effect_operator;
`, "create event-platform test roles")

executeSql(appUrl, `
  CREATE TABLE "organizations" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT NOT NULL
  );
  CREATE TABLE "_prisma_migrations" (
    "migration_name" TEXT PRIMARY KEY,
    "finished_at" TIMESTAMPTZ,
    "rolled_back_at" TIMESTAMPTZ
  );
  CREATE TABLE "funds" (
    "id" TEXT PRIMARY KEY,
    "organizationId" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'AZN',
    "targetAmount" DOUBLE PRECISION,
    "currentBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "color" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE "fund_transactions" (
    "id" TEXT PRIMARY KEY,
    "organizationId" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "fundId" TEXT NOT NULL REFERENCES "funds"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "description" TEXT,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  INSERT INTO "organizations" ("id", "name") VALUES
    ('org-a', 'Tenant A'), ('org-b', 'Tenant B');
  INSERT INTO "funds" ("id", "organizationId", "name", "currency", "targetAmount", "currentBalance", "createdAt") VALUES
    ('fund-a', 'org-a', 'Payroll', 'USD', 100000, 98000, '2026-01-01T00:00:00Z'),
    ('fund-empty', 'org-a', 'Empty', 'EUR', NULL, 0, '2026-01-02T00:00:00Z'),
    ('fund-b', 'org-b', 'Tax', 'AZN', 50000, 5400, '2026-01-03T00:00:00Z');
  INSERT INTO "fund_transactions" (
    "id", "organizationId", "fundId", "type", "amount", "relatedType", "createdAt"
  ) VALUES
    ('tx-a-1', 'org-a', 'fund-a', 'deposit', 45000, 'manual', '2026-02-01T00:00:00Z'),
    ('tx-a-2', 'org-a', 'fund-a', 'withdrawal', 32000, 'manual', '2026-02-02T00:00:00Z');
  INSERT INTO "_prisma_migrations" ("migration_name", "finished_at") VALUES
    ('20260901090000_event_platform_foundation', CURRENT_TIMESTAMP),
    ('20260901100000_fund_event_source_pilot', CURRENT_TIMESTAMP);
`, "create minimal legacy finance schema")

executeFile(migratorUrl, "prisma/migrations/20260901090000_event_platform_foundation/migration.sql")
executeSql(appUrl, `
  INSERT INTO "funds" (
    "id", "organizationId", "name", "currency", "currentBalance", "createdAt"
  ) VALUES
    ('fund-bad-opening', 'org-a', 'Bad opening', 'USD', 10, '2026-03-01T00:00:00Z'),
    ('fund-bad-prefix', 'org-a', 'Bad prefix', 'USD', 10, '2026-03-02T00:00:00Z'),
    ('fund-bad-upper-opening', 'org-a', 'Upper opening', 'USD', 10, '2026-03-05T00:00:00Z'),
    ('fund-bad-upper-prefix', 'org-a', 'Upper prefix', 'USD', 10, '2026-03-06T00:00:00Z');
  INSERT INTO "fund_transactions" (
    "id", "organizationId", "fundId", "type", "amount", "createdAt"
  ) VALUES
    ('tx-bad-opening', 'org-a', 'fund-bad-opening', 'deposit', 20, '2026-03-03T00:00:00Z'),
    ('tx-bad-prefix-1', 'org-a', 'fund-bad-prefix', 'withdrawal', 20, '2026-03-03T00:00:00Z'),
    ('tx-bad-prefix-2', 'org-a', 'fund-bad-prefix', 'deposit', 20, '2026-03-04T00:00:00Z'),
    ('tx-bad-upper-opening', 'org-a', 'fund-bad-upper-opening', 'withdrawal', 99999999999999, '2026-03-07T00:00:00Z'),
    ('tx-bad-upper-prefix-1', 'org-a', 'fund-bad-upper-prefix', 'deposit', 99999999999999, '2026-03-07T00:00:00Z'),
    ('tx-bad-upper-prefix-2', 'org-a', 'fund-bad-upper-prefix', 'withdrawal', 99999999999999, '2026-03-08T00:00:00Z');
`, "create unreplayable legacy Fund fixtures")
expectExecutionRejected("out-of-range opening/prefix bootstrap", () => {
  executeFile(migratorUrl, "prisma/migrations/20260901100000_fund_event_source_pilot/migration.sql")
})
executeSql(appUrl, `
  DELETE FROM "fund_transactions" WHERE "fundId" IN (
    'fund-bad-opening', 'fund-bad-prefix', 'fund-bad-upper-opening', 'fund-bad-upper-prefix'
  );
  DELETE FROM "funds" WHERE "id" IN (
    'fund-bad-opening', 'fund-bad-prefix', 'fund-bad-upper-opening', 'fund-bad-upper-prefix'
  );
`, "remove unreplayable legacy Fund fixtures")
executeFile(migratorUrl, "prisma/migrations/20260901100000_fund_event_source_pilot/migration.sql")
executeFile(migratorUrl, "prisma/migrations/20260906120000_projection_replay_control_plane/migration.sql")
executeFile(migratorUrl, "scripts/event-platform-postconditions.sql")

const admin = makeRlsTestPrisma(adminUrl)
const app = makeRlsTestPrisma(appUrl)
const operator = makeRlsTestPrisma(operatorUrl)

try {
  const [roleFence] = await admin.$queryRawUnsafe(`
    SELECT count(*)::int AS reachable_privileged_roles
      FROM pg_catalog.pg_roles privileged
     WHERE privileged.rolname <> 'event_app'
       AND (privileged.rolsuper OR privileged.rolbypassrls)
       AND pg_catalog.pg_has_role('event_app', privileged.oid, 'SET')
  `)
  if (roleFence.reachable_privileged_roles !== 0) {
    throw new Error(`application role can SET a privileged role: ${JSON.stringify(roleFence)}`)
  }
  const privilegedMembershipDetector = await admin.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`CREATE ROLE event_platform_bypass_probe NOLOGIN NOSUPERUSER BYPASSRLS`)
    await tx.$executeRawUnsafe(`GRANT event_platform_bypass_probe TO event_app`)
    const detected = await tx.$queryRawUnsafe(`
      SELECT count(*)::int AS reachable_privileged_roles
        FROM pg_catalog.pg_roles privileged
       WHERE privileged.rolname <> 'event_app'
         AND (privileged.rolsuper OR privileged.rolbypassrls)
         AND pg_catalog.pg_has_role('event_app', privileged.oid, 'SET')
    `)
    await tx.$executeRawUnsafe(`REVOKE event_platform_bypass_probe FROM event_app`)
    await tx.$executeRawUnsafe(`DROP ROLE event_platform_bypass_probe`)
    return detected
  })
  if (privilegedMembershipDetector[0]?.reachable_privileged_roles !== 1) {
    throw new Error(
      `effective SET ROLE detector missed a BYPASSRLS membership: ${JSON.stringify(privilegedMembershipDetector)}`,
    )
  }

  const [shape] = await admin.$queryRawUnsafe(`
    SELECT
      (SELECT count(*)::int FROM "funds") AS funds,
      (SELECT count(*)::int FROM "domain_events") AS events,
      (SELECT count(*)::int FROM "event_outbox") AS outbox,
      (SELECT count(*)::int FROM "event_aggregate_heads") AS heads,
      (SELECT count(*)::int FROM "fund_balance_projections" WHERE "status" = 'active') AS projections,
      (SELECT count(*)::int FROM "domain_events" WHERE "payloadHash" !~ '^[0-9a-f]{64}$') AS bad_event_hashes,
      (SELECT count(*)::int FROM "event_outbox" WHERE "payloadHash" !~ '^[0-9a-f]{64}$') AS bad_outbox_hashes
  `)
  if (shape.funds !== 3 || shape.events !== 5 || shape.outbox !== 5
      || shape.heads !== 3 || shape.projections !== 3
      || shape.bad_event_hashes !== 0 || shape.bad_outbox_hashes !== 0) {
    throw new Error(`unexpected bootstrap shape: ${JSON.stringify(shape)}`)
  }

  await expectRejected("application access to global cutover evidence", () =>
    app.$queryRawUnsafe(`SELECT * FROM "event_platform_cutover_gates"`),
  )

  const [balance] = await admin.$queryRawUnsafe(`
    SELECT f."currentBalance"::text AS stored,
           p."balance"::text AS rebuilt,
           opening."data" ->> 'openingBalance' AS opening
      FROM "funds" f
      JOIN "fund_balance_projections" p ON p."fundId" = f."id" AND p."status" = 'active'
      JOIN "domain_events" opening ON opening."aggregateId" = f."id"
       AND opening."eventType" = 'finance.fund-opened.v1'
     WHERE f."id" = 'fund-a'
  `)
  if (balance.stored !== "98000.0000" || balance.rebuilt !== "98000.0000" || balance.opening !== "85000.0000") {
    throw new Error(`legacy opening baseline was not preserved: ${JSON.stringify(balance)}`)
  }

  const appTenantAEvents = await app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    return tx.$queryRawUnsafe(`SELECT "organizationId" FROM "domain_events" ORDER BY "recordedAt", "id"`)
  })
  if (appTenantAEvents.length !== 4 || appTenantAEvents.some((row) => row.organizationId !== "org-a")) {
    throw new Error("FORCE RLS did not isolate event history")
  }

  const appTenantAEventsWithSpoofedBypass = await app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    // app.rls_bypass is a legacy application convention, not a PostgreSQL
    // privilege. Canonical event history must ignore a spoofed custom GUC;
    // only the separate database role with real BYPASSRLS may cross tenants.
    await tx.$executeRawUnsafe(`SELECT set_config('app.rls_bypass', 'on', true)`)
    return tx.$queryRawUnsafe(`SELECT "organizationId" FROM "domain_events" ORDER BY "recordedAt", "id"`)
  })
  if (appTenantAEventsWithSpoofedBypass.length !== 4
      || appTenantAEventsWithSpoofedBypass.some((row) => row.organizationId !== "org-a")) {
    throw new Error("spoofed application bypass GUC crossed the canonical event tenant boundary")
  }

  await expectRejected("direct domain-event update", () => app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`UPDATE "domain_events" SET "producer" = 'tampered' WHERE "organizationId" = 'org-a'`)
  }))
  await expectRejected("direct domain-event delete", () => app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`DELETE FROM "domain_events" WHERE "organizationId" = 'org-a'`)
  }))
  await expectRejected("domain-event truncate", () => app.$executeRawUnsafe(`TRUNCATE TABLE "domain_events"`))
  // Exact pinned expand-artifact behavior: INSERT first, then the conditional
  // balance update through the same interactive transaction. The trigger
  // appends the canonical event/projection, while deferred coherence makes the
  // second statement mandatory at commit.
  await app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`
      INSERT INTO "fund_transactions" (
        "id", "organizationId", "fundId", "type", "amount", "createdAt"
      ) VALUES ('tx-legacy', 'org-a', 'fund-a', 'deposit', 10, CURRENT_TIMESTAMP)
    `)
    const updated = await tx.$executeRawUnsafe(`
      UPDATE "funds" SET "currentBalance" = "currentBalance" + 10
       WHERE "id" = 'fund-a' AND "organizationId" = 'org-a'
    `)
    if (updated !== 1) throw new Error(`atomic expand deposit updated ${updated} Fund rows`)
  })
  const [legacyWrite] = await admin.$queryRawUnsafe(`
    SELECT f."currentBalance"::text AS stored,
           p."balance"::text AS projected,
           count(e."id")::int AS event_count
      FROM "funds" f
      JOIN "fund_balance_projections" p
        ON p."organizationId" = f."organizationId" AND p."fundId" = f."id" AND p."status" = 'active'
      LEFT JOIN "domain_events" e
        ON e."organizationId" = f."organizationId"
       AND e."data" ->> 'transactionId' = 'tx-legacy'
     WHERE f."id" = 'fund-a'
     GROUP BY f."currentBalance", p."balance"
  `)
  if (legacyWrite.stored !== "98010.0000" || legacyWrite.projected !== "98010.0000"
      || legacyWrite.event_count !== 1) {
    throw new Error(`atomic expand compatibility path was not exactly-once: ${JSON.stringify(legacyWrite)}`)
  }

  await expectRejected("atomic expand ledger insert without balance update", () => app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`
      INSERT INTO "fund_transactions" (
        "id", "organizationId", "fundId", "type", "amount", "createdAt"
      ) VALUES ('tx-insert-only', 'org-a', 'fund-a', 'deposit', 1, CURRENT_TIMESTAMP)
    `)
  }))

  await app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`
      INSERT INTO "funds" (
        "id", "organizationId", "name", "currency", "currentBalance", "createdAt", "updatedAt"
      ) VALUES (
        'fund-atomic-withdraw', 'org-a', 'Atomic withdrawal probe', 'USD', 150,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `)
  })
  await app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`
      INSERT INTO "fund_transactions" (
        "id", "organizationId", "fundId", "type", "amount", "createdAt"
      ) VALUES (
        'tx-withdraw-partial', 'org-a', 'fund-atomic-withdraw', 'withdrawal', 100,
        CURRENT_TIMESTAMP
      )
    `)
    const updated = await tx.$executeRawUnsafe(`
      UPDATE "funds" SET "currentBalance" = "currentBalance" - 100
       WHERE "id" = 'fund-atomic-withdraw'
         AND "organizationId" = 'org-a'
         AND "currentBalance" >= 100
    `)
    if (updated !== 1) throw new Error(`partial atomic withdrawal updated ${updated} Fund rows`)
  })
  const [partialWithdrawal] = await admin.$queryRawUnsafe(`
    SELECT f."currentBalance"::text AS stored, p."balance"::text AS projected
      FROM "funds" f
      JOIN "fund_balance_projections" p
        ON p."organizationId" = f."organizationId" AND p."fundId" = f."id" AND p."status" = 'active'
     WHERE f."id" = 'fund-atomic-withdraw'
  `)
  if (partialWithdrawal.stored !== "50.0000" || partialWithdrawal.projected !== "50.0000") {
    throw new Error(`partial atomic withdrawal diverged: ${JSON.stringify(partialWithdrawal)}`)
  }
  await app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`
      INSERT INTO "fund_transactions" (
        "id", "organizationId", "fundId", "type", "amount", "createdAt"
      ) VALUES (
        'tx-withdraw-exact', 'org-a', 'fund-atomic-withdraw', 'withdrawal', 50,
        CURRENT_TIMESTAMP
      )
    `)
    const updated = await tx.$executeRawUnsafe(`
      UPDATE "funds" SET "currentBalance" = "currentBalance" - 50
       WHERE "id" = 'fund-atomic-withdraw'
         AND "organizationId" = 'org-a'
         AND "currentBalance" >= 50
    `)
    if (updated !== 1) throw new Error(`exact atomic withdrawal updated ${updated} Fund rows`)
  })
  const [exactWithdrawal] = await admin.$queryRawUnsafe(`
    SELECT f."currentBalance"::text AS stored,
           p."balance"::text AS projected,
           count(e."id")::int AS event_count
      FROM "funds" f
      JOIN "fund_balance_projections" p
        ON p."organizationId" = f."organizationId" AND p."fundId" = f."id" AND p."status" = 'active'
      LEFT JOIN "domain_events" e
        ON e."organizationId" = f."organizationId"
       AND e."data" ->> 'transactionId' IN ('tx-withdraw-partial', 'tx-withdraw-exact')
     WHERE f."id" = 'fund-atomic-withdraw'
     GROUP BY f."currentBalance", p."balance"
  `)
  if (exactWithdrawal.stored !== "0.0000" || exactWithdrawal.projected !== "0.0000"
      || exactWithdrawal.event_count !== 2) {
    throw new Error(`exact atomic withdrawal diverged: ${JSON.stringify(exactWithdrawal)}`)
  }

  // A production-capable seed can preserve all-or-nothing behavior while
  // writing multiple ledger entries for one Fund by flushing the deferred
  // coherence pair after each complete INSERT-first mutation. Without the
  // flush, the first trigger's captured intermediate balance is compared with
  // the transaction's final balance at commit and must fail closed.
  await app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`
      INSERT INTO "funds" (
        "id", "organizationId", "name", "currency", "currentBalance", "createdAt", "updatedAt"
      ) VALUES (
        'fund-batched-seed', 'org-a', 'Batched seed probe', 'USD', 0,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `)
  })
  await app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    for (const [transactionId, amount] of [['tx-batched-seed-1', 12], ['tx-batched-seed-2', 15]]) {
      await tx.$executeRawUnsafe(`
        INSERT INTO "fund_transactions" (
          "id", "organizationId", "fundId", "type", "amount", "createdAt"
        ) VALUES ($1, 'org-a', 'fund-batched-seed', 'deposit', $2, CURRENT_TIMESTAMP)
      `, transactionId, amount)
      const updated = await tx.$executeRawUnsafe(`
        UPDATE "funds" SET "currentBalance" = "currentBalance" + $1
         WHERE "id" = 'fund-batched-seed' AND "organizationId" = 'org-a'
      `, amount)
      if (updated !== 1) throw new Error(`batched seed mutation updated ${updated} Fund rows`)
      await tx.$executeRawUnsafe(`SET CONSTRAINTS ALL IMMEDIATE`)
      await tx.$executeRawUnsafe(`SET CONSTRAINTS ALL DEFERRED`)
    }
  })
  const [batchedSeed] = await admin.$queryRawUnsafe(`
    SELECT f."currentBalance"::text AS stored,
           p."balance"::text AS projected,
           count(e."id")::int AS event_count
      FROM "funds" f
      JOIN "fund_balance_projections" p
        ON p."organizationId" = f."organizationId" AND p."fundId" = f."id" AND p."status" = 'active'
      LEFT JOIN "domain_events" e
        ON e."organizationId" = f."organizationId"
       AND e."data" ->> 'transactionId' IN ('tx-batched-seed-1', 'tx-batched-seed-2')
     WHERE f."id" = 'fund-batched-seed'
     GROUP BY f."currentBalance", p."balance"
  `)
  if (batchedSeed.stored !== "27.0000" || batchedSeed.projected !== "27.0000"
      || batchedSeed.event_count !== 2) {
    throw new Error(`batched atomic seed path diverged: ${JSON.stringify(batchedSeed)}`)
  }

  await app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`
      INSERT INTO "funds" (
        "id", "organizationId", "name", "currency", "currentBalance", "createdAt", "updatedAt"
      ) VALUES ('fund-legacy', 'org-a', 'Legacy-created', 'USD', 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `)
  })
  const [legacyFund] = await admin.$queryRawUnsafe(`
    SELECT count(e."id")::int AS event_count, count(p."id")::int AS projection_count
      FROM "funds" f
      LEFT JOIN "domain_events" e
        ON e."organizationId" = f."organizationId" AND e."aggregateId" = f."id"
       AND e."eventType" = 'finance.fund-opened.v1'
      LEFT JOIN "fund_balance_projections" p
        ON p."organizationId" = f."organizationId" AND p."fundId" = f."id" AND p."status" = 'active'
     WHERE f."id" = 'fund-legacy'
  `)
  if (legacyFund.event_count !== 1 || legacyFund.projection_count !== 1) {
    throw new Error(`legacy Fund INSERT did not create its canonical stream: ${JSON.stringify(legacyFund)}`)
  }

  // A rollback artifact still issues physical DELETE. It must fail closed even
  // for a Fund with no ledger rows; otherwise FK cascade removes the active
  // projection while immutable event/head rows survive as an orphan stream.
  await expectRejected("legacy Fund hard delete", () => app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`DELETE FROM "funds" WHERE "id" = 'fund-empty'`)
  }))
  const [hardDeleteFence] = await admin.$queryRawUnsafe(`
    SELECT
      (SELECT count(*)::int FROM "funds" WHERE "id" = 'fund-empty') AS funds,
      (SELECT count(*)::int FROM "event_aggregate_heads"
        WHERE "aggregateType" = 'fund' AND "aggregateId" = 'fund-empty') AS heads,
      (SELECT count(*)::int FROM "domain_events"
        WHERE "aggregateType" = 'fund' AND "aggregateId" = 'fund-empty') AS events,
      (SELECT count(*)::int FROM "fund_balance_projections"
        WHERE "fundId" = 'fund-empty' AND "status" = 'active') AS projections
  `)
  if (hardDeleteFence.funds !== 1 || hardDeleteFence.heads !== 1
      || hardDeleteFence.events !== 1 || hardDeleteFence.projections !== 1) {
    throw new Error(`legacy Fund DELETE escaped the archive fence: ${JSON.stringify(hardDeleteFence)}`)
  }

  await expectRejected("event-source GUC cannot bypass commit invariant", () => app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`SELECT set_config('app.event_source_write', 'on', true)`)
    await tx.$executeRawUnsafe(`
      INSERT INTO "fund_transactions" (
        "id", "organizationId", "fundId", "type", "amount", "createdAt"
      ) VALUES ('tx-no-event', 'org-a', 'fund-a', 'deposit', 1, CURRENT_TIMESTAMP)
    `)
  }))
  await expectRejected("cross-tenant fund reference", () => app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-b', true)`)
    await tx.$executeRawUnsafe(`SELECT set_config('app.event_source_write', 'on', true)`)
    await tx.$executeRawUnsafe(`
      INSERT INTO "fund_transactions" (
        "id", "organizationId", "fundId", "type", "amount", "createdAt"
      ) VALUES ('tx-cross-tenant', 'org-b', 'fund-a', 'deposit', 1, CURRENT_TIMESTAMP)
    `)
  }))
  await expectRejected("fund transaction update", () => app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`UPDATE "fund_transactions" SET "amount" = 11 WHERE "id" = 'tx-legacy'`)
  }))
  await expectRejected("fund transaction delete", () => app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`DELETE FROM "fund_transactions" WHERE "id" = 'tx-legacy'`)
  }))
  await expectRejected("fund currency relabel even with writer GUC", () => app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`SELECT set_config('app.event_source_write', 'on', true)`)
    await tx.$executeRawUnsafe(`UPDATE "funds" SET "currency" = 'EUR' WHERE "id" = 'fund-a'`)
  }))
  await expectRejected("active fund projection cannot be corrupted directly", () => app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`
      UPDATE "fund_balance_projections"
         SET "balance" = "balance" + 1
       WHERE "organizationId" = 'org-a' AND "fundId" = 'fund-a' AND "status" = 'active'
    `)
  }))

  await expectRejected("orphan domain event at commit", () => app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`
      INSERT INTO "event_aggregate_heads" (
        "organizationId", "aggregateType", "aggregateId", "currentVersion", "lastEventId", "lastEventAt"
      ) VALUES (
        'org-a', 'fund', 'orphan-probe', 1,
        '018f7b34-9bb9-7b32-8de8-1fbb4feeb398', '2026-09-01T12:00:00Z'
      )
    `)
    await tx.$executeRawUnsafe(`
      INSERT INTO "domain_events" (
        "id", "organizationId", "aggregateType", "aggregateId", "aggregateVersion",
        "eventType", "eventVersion", "source", "dataSchema", "classification",
        "correlationId", "producer", "producerVersion", "data", "occurredAt"
      ) VALUES (
        '018f7b34-9bb9-7b32-8de8-1fbb4feeb398', 'org-a', 'fund', 'orphan-probe', 1,
        'finance.fund-opened.v1', 1, 'urn:leaddrive:finance',
        'urn:leaddrive:schema:finance.fund-opened:v1', 'confidential',
        'orphan-probe', 'ci-probe', 'ci-probe-1',
        '{"fundId":"orphan-probe","currency":"USD","openingBalance":"0.0000"}'::jsonb,
        '2026-09-01T12:00:00Z'
      )
    `)
  }))
  await expectRejected("outbox routing mismatch", () => app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`
      INSERT INTO "event_aggregate_heads" (
        "organizationId", "aggregateType", "aggregateId", "currentVersion", "lastEventId", "lastEventAt"
      ) VALUES (
        'org-a', 'fund', 'coherence-probe', 1,
        '018f7b34-9bb9-7b32-8de8-1fbb4feeb399', '2026-09-01T12:00:00Z'
      )
    `)
    await tx.$executeRawUnsafe(`
      INSERT INTO "domain_events" (
        "id", "organizationId", "aggregateType", "aggregateId", "aggregateVersion",
        "eventType", "eventVersion", "source", "dataSchema", "classification",
        "subjectRef", "correlationId", "producer", "producerVersion", "data", "occurredAt"
      ) VALUES (
        '018f7b34-9bb9-7b32-8de8-1fbb4feeb399', 'org-a', 'fund', 'coherence-probe', 1,
        'finance.fund-opened.v1', 1, 'urn:leaddrive:finance',
        'urn:leaddrive:schema:finance.fund-opened:v1', 'confidential',
        'fund/coherence-probe', 'coherence-probe', 'ci-probe', 'ci-probe-1',
        '{"fundId":"coherence-probe","currency":"USD","openingBalance":"0.0000"}'::jsonb,
        '2026-09-01T12:00:00Z'
      )
    `)
    await tx.$executeRawUnsafe(`
      INSERT INTO "event_outbox" (
        "organizationId", "eventId", "eventType", "topic", "partitionKey", "envelope"
      ) VALUES (
        'org-a', '018f7b34-9bb9-7b32-8de8-1fbb4feeb399', 'finance.fund-opened.v1',
        'leaddrive.domain.wrong.v1', 'org-a:fund:coherence-probe',
        '{
          "specversion":"1.0",
          "id":"018f7b34-9bb9-7b32-8de8-1fbb4feeb399",
          "source":"urn:leaddrive:finance",
          "type":"finance.fund-opened.v1",
          "time":"2026-09-01T12:00:00.000Z",
          "datacontenttype":"application/json",
          "dataschema":"urn:leaddrive:schema:finance.fund-opened:v1",
          "organizationid":"org-a",
          "aggregatetype":"fund",
          "aggregateid":"coherence-probe",
          "aggregateversion":1,
          "correlationid":"coherence-probe",
          "producer":"ci-probe",
          "producerversion":"ci-probe-1",
          "classification":"confidential",
          "subjectref":"fund/coherence-probe",
          "data":{"fundId":"coherence-probe","currency":"USD","openingBalance":"0.0000"}
        }'::jsonb
      )
    `)
  }))
  await expectRejected("outbox envelope missing identity", () => app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`
      INSERT INTO "event_aggregate_heads" (
        "organizationId", "aggregateType", "aggregateId", "currentVersion", "lastEventId", "lastEventAt"
      ) VALUES (
        'org-a', 'fund', 'envelope-probe', 1,
        '018f7b34-9bb9-7b32-8de8-1fbb4feeb39a', '2026-09-01T12:00:00Z'
      )
    `)
    await tx.$executeRawUnsafe(`
      INSERT INTO "domain_events" (
        "id", "organizationId", "aggregateType", "aggregateId", "aggregateVersion",
        "eventType", "eventVersion", "source", "dataSchema", "classification",
        "subjectRef", "correlationId", "producer", "producerVersion", "data", "occurredAt"
      ) VALUES (
        '018f7b34-9bb9-7b32-8de8-1fbb4feeb39a', 'org-a', 'fund', 'envelope-probe', 1,
        'finance.fund-opened.v1', 1, 'urn:leaddrive:finance',
        'urn:leaddrive:schema:finance.fund-opened:v1', 'confidential',
        'fund/envelope-probe', 'envelope-probe', 'ci-probe', 'ci-probe-1',
        '{"fundId":"envelope-probe","currency":"USD","openingBalance":"0.0000"}'::jsonb,
        '2026-09-01T12:00:00Z'
      )
    `)
    await tx.$executeRawUnsafe(`
      INSERT INTO "event_outbox" (
        "organizationId", "eventId", "eventType", "topic", "partitionKey", "envelope"
      ) VALUES (
        'org-a', '018f7b34-9bb9-7b32-8de8-1fbb4feeb39a', 'finance.fund-opened.v1',
        'leaddrive.domain.finance.v1', 'org-a:fund:envelope-probe',
        '{"data":{"fundId":"envelope-probe","currency":"USD","openingBalance":"0.0000"}}'::jsonb
      )
    `)
  }))

  await expectRejected("replay projection cannot enable effects", () => app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`
      INSERT INTO "projection_builds" (
        "organizationId", "projectionName", "projectionVersion", "buildKey",
        "codeSha", "mode", "effectsFenced"
      ) VALUES ('org-a', 'fund-balance', 2, 'unsafe-replay', repeat('a', 40), 'replay', false)
    `)
  }))

  await app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`
      INSERT INTO "projection_builds" (
        "id", "organizationId", "projectionName", "projectionVersion", "buildKey",
        "codeSha", "mode", "effectsFenced"
      ) VALUES (
        '018f7b34-9bb9-7b32-8de8-1fbb4feeb401', 'org-a', 'fund-balance', 2,
        'checkpoint-probe', repeat('a', 40), 'replay', true
      )
    `)
    await tx.$executeRawUnsafe(`
      UPDATE "projection_builds" SET "status" = 'running', "startedAt" = CURRENT_TIMESTAMP
       WHERE "id" = '018f7b34-9bb9-7b32-8de8-1fbb4feeb401'
    `)
    await tx.$executeRawUnsafe(`
      INSERT INTO "projection_checkpoints" (
        "organizationId", "buildId", "sourceTopic", "sourcePartition", "sourceOffset", "lastEventId"
      ) VALUES (
        'org-a', '018f7b34-9bb9-7b32-8de8-1fbb4feeb401', 'ld.drill.finance.events.v1', 0, 10,
        '018f7b34-9bb9-7b32-8de8-1fbb4feeb402'
      )
    `)
  })
  await expectRejected("projection checkpoint rewind", () => app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`
      UPDATE "projection_checkpoints" SET "sourceOffset" = 9
       WHERE "organizationId" = 'org-a'
         AND "buildId" = '018f7b34-9bb9-7b32-8de8-1fbb4feeb401'
         AND "sourceTopic" = 'ld.drill.finance.events.v1' AND "sourcePartition" = 0
    `)
  }))

  await app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`
      INSERT INTO "projection_builds" (
        "id", "organizationId", "projectionName", "projectionVersion", "buildKey",
        "codeSha", "mode", "effectsFenced"
      ) VALUES (
        '018f7b34-9bb9-7b32-8de8-1fbb4feeb410', 'org-a', 'fund-balance', 3,
        'promotion-probe', repeat('b', 40), 'shadow', true
      )
    `)
    await tx.$executeRawUnsafe(`
      UPDATE "projection_builds" SET "status" = 'running', "startedAt" = CURRENT_TIMESTAMP
       WHERE "id" = '018f7b34-9bb9-7b32-8de8-1fbb4feeb410'
    `)
    await tx.$executeRawUnsafe(`UPDATE "projection_builds" SET "status" = 'verifying'
      WHERE "id" = '018f7b34-9bb9-7b32-8de8-1fbb4feeb410'`)
    await tx.$executeRawUnsafe(`UPDATE "projection_builds"
      SET "status" = 'ready', "completedAt" = CURRENT_TIMESTAMP
      WHERE "id" = '018f7b34-9bb9-7b32-8de8-1fbb4feeb410'`)
    await tx.$executeRawUnsafe(`UPDATE "projection_builds"
      SET "status" = 'promoted', "promotedAt" = CURRENT_TIMESTAMP
      WHERE "id" = '018f7b34-9bb9-7b32-8de8-1fbb4feeb410'`)
    await tx.$executeRawUnsafe(`
      INSERT INTO "projection_promotion_events" (
        "organizationId", "projectionName", "targetBuildId", "action", "requestKey",
        "requestedBy", "approvedBy", "evidenceHash", "resultingPointerVersion"
      ) VALUES (
        'org-a', 'fund-balance', '018f7b34-9bb9-7b32-8de8-1fbb4feeb410', 'promote',
        'promotion-probe-1', 'operator-a', 'operator-b', repeat('c', 64), 1
      )
    `)
    await tx.$executeRawUnsafe(`
      INSERT INTO "projection_activations" (
        "organizationId", "projectionName", "activeBuildId", "activationVersion"
      ) VALUES (
        'org-a', 'fund-balance', '018f7b34-9bb9-7b32-8de8-1fbb4feeb410', 1
      )
    `)
  })
  await expectRejected("projection promotion self approval", () => app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`
      INSERT INTO "projection_promotion_events" (
        "organizationId", "projectionName", "targetBuildId", "action", "requestKey",
        "requestedBy", "approvedBy", "evidenceHash", "resultingPointerVersion"
      ) VALUES (
        'org-a', 'fund-balance', '018f7b34-9bb9-7b32-8de8-1fbb4feeb410', 'rollback',
        'self-approval-probe', 'operator-a', 'operator-a', repeat('d', 64), 2
      )
    `)
  }))
  await expectRejected("projection pointer without matching evidence", () => app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`
      UPDATE "projection_activations"
         SET "activationVersion" = 2
       WHERE "organizationId" = 'org-a' AND "projectionName" = 'fund-balance'
    `)
  }))

  const [sourceEvent] = await admin.$queryRawUnsafe(`
    SELECT "id"::text AS id
      FROM "domain_events"
     WHERE "organizationId" = 'org-a'
       AND "aggregateId" = 'fund-a'
       AND "aggregateVersion" = 1
  `)

  await expectRejected("effect cannot start succeeded", () => app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`
      INSERT INTO "effect_outbox" (
        "id", "organizationId", "sourceEventId", "effectType", "effectKey",
        "destination", "payload", "status", "completedAt"
      ) VALUES (
        '018f7b34-9bb9-7b32-8de8-1fbb4feeb3a0', 'org-a', '${sourceEvent.id}',
        'notification.email', 'invalid-initial-state', 'email:test@example.com',
        '{"template":"fund-updated"}'::jsonb, 'succeeded', CURRENT_TIMESTAMP
      )
    `)
  }))

  await app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`
      INSERT INTO "effect_outbox" (
        "id", "organizationId", "sourceEventId", "effectType", "effectKey",
        "destination", "payload"
      ) VALUES (
        '018f7b34-9bb9-7b32-8de8-1fbb4feeb3a1', 'org-a', '${sourceEvent.id}',
        'notification.email', 'successful-effect', 'email:test@example.com',
        '{"template":"fund-updated"}'::jsonb
      )
    `)
    await tx.$executeRawUnsafe(`
      UPDATE "effect_outbox"
         SET "status" = 'leased', "attemptCount" = 1, "leaseOwner" = 'worker-a',
             "leaseToken" = '018f7b34-9bb9-7b32-8de8-1fbb4feeb3b1',
             "leaseExpiresAt" = CURRENT_TIMESTAMP + interval '5 minutes',
             "providerRequestId" = 'request-success-1'
       WHERE "id" = '018f7b34-9bb9-7b32-8de8-1fbb4feeb3a1'
    `)
  })
  await expectRejected("effect terminal transition requires evidence", () => app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`
      UPDATE "effect_outbox"
         SET "status" = 'succeeded', "leaseOwner" = NULL, "leaseToken" = NULL,
             "leaseExpiresAt" = NULL, "completedAt" = CURRENT_TIMESTAMP
       WHERE "id" = '018f7b34-9bb9-7b32-8de8-1fbb4feeb3a1'
    `)
  }))
  await app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`
      INSERT INTO "effect_attempts" (
        "organizationId", "effectId", "attemptNumber", "leaseToken", "requestId", "outcome"
      ) VALUES (
        'org-a', '018f7b34-9bb9-7b32-8de8-1fbb4feeb3a1', 1,
        '018f7b34-9bb9-7b32-8de8-1fbb4feeb3b1', 'request-success-1', 'started'
      )
    `)
    await tx.$executeRawUnsafe(`
      INSERT INTO "effect_attempts" (
        "organizationId", "effectId", "attemptNumber", "leaseToken", "requestId",
        "outcome", "responseCode", "providerReference", "completedAt"
      ) VALUES (
        'org-a', '018f7b34-9bb9-7b32-8de8-1fbb4feeb3a1', 1,
        '018f7b34-9bb9-7b32-8de8-1fbb4feeb3b1', 'request-success-1',
        'succeeded', 202, 'provider-success-1', CURRENT_TIMESTAMP
      )
    `)
    await tx.$executeRawUnsafe(`
      UPDATE "effect_outbox"
         SET "status" = 'succeeded', "leaseOwner" = NULL, "leaseToken" = NULL,
             "leaseExpiresAt" = NULL, "providerResult" = '{"accepted":true}'::jsonb,
             "completedAt" = CURRENT_TIMESTAMP
       WHERE "id" = '018f7b34-9bb9-7b32-8de8-1fbb4feeb3a1'
    `)
  })

  await app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`
      INSERT INTO "effect_outbox" (
        "id", "organizationId", "sourceEventId", "effectType", "effectKey", "destination", "payload"
      ) VALUES (
        '018f7b34-9bb9-7b32-8de8-1fbb4feeb3a2', 'org-a', '${sourceEvent.id}',
        'notification.email', 'expired-before-start', 'email:test@example.com', '{}'
      )
    `)
    await tx.$executeRawUnsafe(`
      UPDATE "effect_outbox"
         SET "status" = 'leased', "attemptCount" = 1, "leaseOwner" = 'worker-a',
             "leaseToken" = '018f7b34-9bb9-7b32-8de8-1fbb4feeb3b2',
             "leaseExpiresAt" = CURRENT_TIMESTAMP + interval '100 milliseconds',
             "providerRequestId" = 'request-expired-1'
       WHERE "id" = '018f7b34-9bb9-7b32-8de8-1fbb4feeb3a2'
    `)
  })
  await new Promise((resolve) => setTimeout(resolve, 200))
  await app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`
      UPDATE "effect_outbox"
         SET "status" = 'pending', "leaseOwner" = NULL, "leaseToken" = NULL,
             "leaseExpiresAt" = NULL, "providerRequestId" = NULL
       WHERE "id" = '018f7b34-9bb9-7b32-8de8-1fbb4feeb3a2'
    `)
  })

  await app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`
      INSERT INTO "effect_outbox" (
        "id", "organizationId", "sourceEventId", "effectType", "effectKey", "destination", "payload"
      ) VALUES (
        '018f7b34-9bb9-7b32-8de8-1fbb4feeb3a3', 'org-a', '${sourceEvent.id}',
        'payment.capture', 'definite-failure', 'payment:test', '{}'
      )
    `)
    await tx.$executeRawUnsafe(`
      UPDATE "effect_outbox"
         SET "status" = 'leased', "attemptCount" = 1, "leaseOwner" = 'worker-a',
             "leaseToken" = '018f7b34-9bb9-7b32-8de8-1fbb4feeb3b3',
             "leaseExpiresAt" = CURRENT_TIMESTAMP + interval '5 minutes',
             "providerRequestId" = 'request-failed-1'
       WHERE "id" = '018f7b34-9bb9-7b32-8de8-1fbb4feeb3a3'
    `)
    await tx.$executeRawUnsafe(`
      INSERT INTO "effect_attempts" (
        "organizationId", "effectId", "attemptNumber", "leaseToken", "requestId", "outcome"
      ) VALUES (
        'org-a', '018f7b34-9bb9-7b32-8de8-1fbb4feeb3a3', 1,
        '018f7b34-9bb9-7b32-8de8-1fbb4feeb3b3', 'request-failed-1', 'started'
      )
    `)
    await tx.$executeRawUnsafe(`
      INSERT INTO "effect_attempts" (
        "organizationId", "effectId", "attemptNumber", "leaseToken", "requestId",
        "outcome", "errorMessage", "completedAt"
      ) VALUES (
        'org-a', '018f7b34-9bb9-7b32-8de8-1fbb4feeb3a3', 1,
        '018f7b34-9bb9-7b32-8de8-1fbb4feeb3b3', 'request-failed-1',
        'definitely_failed', 'provider rejected before execution', CURRENT_TIMESTAMP
      )
    `)
    await tx.$executeRawUnsafe(`
      UPDATE "effect_outbox"
         SET "status" = 'definitely_failed', "leaseOwner" = NULL, "leaseToken" = NULL,
             "leaseExpiresAt" = NULL, "lastError" = 'provider rejected before execution'
       WHERE "id" = '018f7b34-9bb9-7b32-8de8-1fbb4feeb3a3'
    `)
  })
  await expectRejected("application cannot authorize effect retry", () => app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`
      UPDATE "effect_outbox"
         SET "status" = 'pending', "providerRequestId" = NULL,
             "providerResult" = NULL, "lastError" = NULL
       WHERE "id" = '018f7b34-9bb9-7b32-8de8-1fbb4feeb3a3'
    `)
  }))

  await app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`
      INSERT INTO "effect_outbox" (
        "id", "organizationId", "sourceEventId", "effectType", "effectKey", "destination", "payload"
      ) VALUES (
        '018f7b34-9bb9-7b32-8de8-1fbb4feeb3a4', 'org-a', '${sourceEvent.id}',
        'payment.capture', 'ambiguous-effect', 'payment:test', '{"amount":"10.0000"}'
      )
    `)
    await tx.$executeRawUnsafe(`
      UPDATE "effect_outbox"
         SET "status" = 'leased', "attemptCount" = 1, "leaseOwner" = 'worker-a',
             "leaseToken" = '018f7b34-9bb9-7b32-8de8-1fbb4feeb3b4',
             "leaseExpiresAt" = CURRENT_TIMESTAMP + interval '5 minutes',
             "providerRequestId" = 'request-ambiguous-1'
       WHERE "id" = '018f7b34-9bb9-7b32-8de8-1fbb4feeb3a4'
    `)
    await tx.$executeRawUnsafe(`
      INSERT INTO "effect_attempts" (
        "organizationId", "effectId", "attemptNumber", "leaseToken", "requestId", "outcome"
      ) VALUES (
        'org-a', '018f7b34-9bb9-7b32-8de8-1fbb4feeb3a4', 1,
        '018f7b34-9bb9-7b32-8de8-1fbb4feeb3b4', 'request-ambiguous-1', 'started'
      )
    `)
    await tx.$executeRawUnsafe(`
      INSERT INTO "effect_attempts" (
        "organizationId", "effectId", "attemptNumber", "leaseToken", "requestId",
        "outcome", "errorMessage", "completedAt"
      ) VALUES (
        'org-a', '018f7b34-9bb9-7b32-8de8-1fbb4feeb3a4', 1,
        '018f7b34-9bb9-7b32-8de8-1fbb4feeb3b4', 'request-ambiguous-1',
        'reconciliation_required', 'provider timeout after request acceptance', CURRENT_TIMESTAMP
      )
    `)
    await tx.$executeRawUnsafe(`
      UPDATE "effect_outbox"
         SET "status" = 'reconciliation_required', "leaseOwner" = NULL,
             "leaseToken" = NULL, "leaseExpiresAt" = NULL,
             "lastError" = 'provider outcome unknown', "reconciliationAt" = CURRENT_TIMESTAMP
       WHERE "id" = '018f7b34-9bb9-7b32-8de8-1fbb4feeb3a4'
    `)
  })
  await expectRejected("application cannot append reconciliation evidence", () => app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`
      INSERT INTO "effect_reconciliations" (
        "organizationId", "effectId", "attemptNumber", "decision", "reason", "evidence"
      ) VALUES (
        'org-a', '018f7b34-9bb9-7b32-8de8-1fbb4feeb3a4', 1, 'retry',
        'provider confirms no capture', '{"ticket":"INC-1"}'::jsonb
      )
    `)
  }))
  await expectRejected("operator transition requires reconciliation evidence", () => operator.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE leaddrive_effect_operator`)
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`
      UPDATE "effect_outbox"
         SET "status" = 'pending', "providerRequestId" = NULL,
             "providerResult" = NULL, "lastError" = NULL,
             "reconciliationAt" = NULL
       WHERE "id" = '018f7b34-9bb9-7b32-8de8-1fbb4feeb3a4'
    `)
  }))
  await expectRejected("reconciliation evidence requires same-transaction transition", () => operator.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE leaddrive_effect_operator`)
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`
      INSERT INTO "effect_reconciliations" (
        "organizationId", "effectId", "attemptNumber", "decision", "reason", "evidence"
      ) VALUES (
        'org-a', '018f7b34-9bb9-7b32-8de8-1fbb4feeb3a4', 1, 'retry',
        'provider read-back proves no capture',
        '{"ticket":"INC-evidence-only","providerStatus":"not_found"}'::jsonb
      )
    `)
  }))
  await operator.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE leaddrive_effect_operator`)
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`
      INSERT INTO "effect_reconciliations" (
        "organizationId", "effectId", "attemptNumber", "decision", "reason", "evidence", "reconciledAt"
      ) VALUES (
        'org-a', '018f7b34-9bb9-7b32-8de8-1fbb4feeb3a4', 1, 'retry',
        'provider read-back proves no capture',
        '{"ticket":"INC-1","providerStatus":"not_found","approvedBy":"on-call"}'::jsonb,
        '1900-01-01T00:00:00Z'
      )
    `)
    await tx.$executeRawUnsafe(`
      UPDATE "effect_outbox"
         SET "status" = 'pending', "providerRequestId" = NULL,
             "providerResult" = NULL, "lastError" = NULL,
             "reconciliationAt" = NULL
       WHERE "id" = '018f7b34-9bb9-7b32-8de8-1fbb4feeb3a4'
    `)
  })
  await expectRejected("reconciliation evidence update", () => operator.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE leaddrive_effect_operator`)
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`UPDATE "effect_reconciliations" SET "reason" = 'changed'`)
  }))
  const [reconciliationEvidence] = await admin.$queryRawUnsafe(`
    SELECT e."status", r."decision", r."operatorRole" AS operator_role,
           r."sessionIdentity" AS session_identity,
           (r."reconciledAt" > CURRENT_TIMESTAMP - interval '1 minute'
             AND r."reconciledAt" <= CURRENT_TIMESTAMP) AS server_timestamp,
           r."evidenceHash" AS evidence_hash
      FROM "effect_outbox" e
      JOIN "effect_reconciliations" r
        ON r."organizationId" = e."organizationId" AND r."effectId" = e."id"
     WHERE e."id" = '018f7b34-9bb9-7b32-8de8-1fbb4feeb3a4'
  `)
  if (reconciliationEvidence.status !== "pending"
      || reconciliationEvidence.decision !== "retry"
      || reconciliationEvidence.operator_role !== "leaddrive_effect_operator"
      || reconciliationEvidence.session_identity !== "effect_operator_jit"
      || reconciliationEvidence.server_timestamp !== true
      || !/^[0-9a-f]{64}$/.test(reconciliationEvidence.evidence_hash)) {
    throw new Error(`effect reconciliation evidence mismatch: ${JSON.stringify(reconciliationEvidence)}`)
  }
  // Clearing the mutable ambiguity markers must make a genuinely new attempt
  // possible; the immutable reconciliation row remains as the audit trail for
  // attempt 1 while the new lease receives attempt number 2.
  await app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`
      UPDATE "effect_outbox"
         SET "status" = 'leased', "attemptCount" = 2, "leaseOwner" = 'worker-b',
             "leaseToken" = '018f7b34-9bb9-7b32-8de8-1fbb4feeb3b5',
             "leaseExpiresAt" = CURRENT_TIMESTAMP + interval '5 minutes',
             "providerRequestId" = 'request-ambiguous-2'
       WHERE "id" = '018f7b34-9bb9-7b32-8de8-1fbb4feeb3a4'
    `)
  })
  await expectRejected("effect deletion", () => app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', 'org-a', true)`)
    await tx.$executeRawUnsafe(`
      DELETE FROM "effect_outbox" WHERE "id" = '018f7b34-9bb9-7b32-8de8-1fbb4feeb3a2'
    `)
  }))

  const [effectEvidence] = await admin.$queryRawUnsafe(`
    SELECT e."status", e."attemptCount" AS attempt_count,
           count(a."id")::int AS attempt_rows
      FROM "effect_outbox" e
      LEFT JOIN "effect_attempts" a ON a."organizationId" = e."organizationId" AND a."effectId" = e."id"
     WHERE e."id" = '018f7b34-9bb9-7b32-8de8-1fbb4feeb3a1'
     GROUP BY e."status", e."attemptCount"
  `)
  if (effectEvidence.status !== "succeeded" || effectEvidence.attempt_count !== 1
      || effectEvidence.attempt_rows !== 2) {
    throw new Error(`effect evidence/state machine mismatch: ${JSON.stringify(effectEvidence)}`)
  }

  // Explicit tenant deletion is the sole allowed history purge: SET LOCAL plus
  // nested FK cascade plus absent parent are all required by the trigger.
  await app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.event_history_purge', 'on', true)`)
    await tx.$executeRawUnsafe(`DELETE FROM "organizations" WHERE "id" = 'org-a'`)
  })
  const [remaining] = await admin.$queryRawUnsafe(`
    SELECT
      (SELECT count(*)::int FROM "organizations" WHERE "id" = 'org-a') AS organizations,
      (SELECT count(*)::int FROM "domain_events" WHERE "organizationId" = 'org-a') AS events,
      (SELECT count(*)::int FROM "event_outbox" WHERE "organizationId" = 'org-a') AS outbox,
      (SELECT count(*)::int FROM "fund_transactions" WHERE "organizationId" = 'org-a') AS transactions
  `)
  if (remaining.organizations !== 0 || remaining.events !== 0
      || remaining.outbox !== 0 || remaining.transactions !== 0) {
    throw new Error(`tenant cascade left event-platform rows: ${JSON.stringify(remaining)}`)
  }

  await expectRejected("cutover verification without bound hashes", () => admin.$executeRawUnsafe(`
    UPDATE "event_platform_cutover_gates"
       SET "status" = 'verified', "verifiedAt" = CURRENT_TIMESTAMP
     WHERE "gateKey" = 'fund-event-source-v1'
  `))
  const verifiedGates = await admin.$queryRawUnsafe(`
    UPDATE "event_platform_cutover_gates"
       SET "status" = 'verified',
           "verifiedAt" = CURRENT_TIMESTAMP,
           "verifiedArtifactSha" = repeat('a', 40),
           "previousArtifactSha" = repeat('b', 40),
           "previousClientHash" = repeat('c', 64),
           "migrationChecksum" = repeat('d', 64),
           "backupEvidenceHash" = repeat('e', 64)
     WHERE "gateKey" = 'fund-event-source-v1'
       AND "migrationName" = '20260901100000_fund_event_source_pilot'
       AND "status" = 'migration_applied'
    RETURNING "status", "verifiedArtifactSha", "previousArtifactSha"
  `)
  if (verifiedGates.length !== 1 || verifiedGates[0].status !== "verified"
      || verifiedGates[0].verifiedArtifactSha !== "a".repeat(40)
      || verifiedGates[0].previousArtifactSha !== "b".repeat(40)) {
    throw new Error(`cutover gate did not advance exactly once: ${JSON.stringify(verifiedGates)}`)
  }
  await expectRejected("repeated cutover verification", () => admin.$executeRawUnsafe(`
    UPDATE "event_platform_cutover_gates"
       SET "backupEvidenceHash" = repeat('f', 64)
     WHERE "gateKey" = 'fund-event-source-v1'
  `))
  await expectRejected("cutover evidence deletion", () => admin.$executeRawUnsafe(`
    DELETE FROM "event_platform_cutover_gates" WHERE "gateKey" = 'fund-event-source-v1'
  `))
  await expectRejected("cutover evidence truncate", () => admin.$executeRawUnsafe(`
    TRUNCATE TABLE "event_platform_cutover_gates"
  `))

  // The same read-only gate that blocks production activation must still pass
  // after old-artifact compatibility writes, effect transitions and a full
  // tenant cascade.
  executeFile(migratorUrl, "scripts/event-platform-postconditions.sql")

  console.log("event-platform migration integration: PASS")
} finally {
  await Promise.allSettled([admin.$disconnect(), app.$disconnect(), operator.$disconnect()])
}
