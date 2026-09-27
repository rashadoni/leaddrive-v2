import { randomUUID } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { Prisma, PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_V1 } from "@/lib/workforce/exception-policy-draft"
import { WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_HASH_V1 } from "@/lib/workforce/exception-policy-revision"

const databaseUrl = process.env.WORKFORCE_EXCEPTION_LOCK_TEST_DATABASE_URL
const integrationDatabaseUrl = databaseUrl
  ?? "postgresql://disabled:disabled@127.0.0.1:1/disabled"
const postgresDescribe = databaseUrl ? describe : describe.skip
const schema = `workforce_policy_revision_${randomUUID().replaceAll("-", "")}`
const roleSuffix = randomUUID().replaceAll("-", "").slice(0, 16)
const migrationOwnerRole = `workforce_policy_owner_${roleSuffix}`
const migrationLoginRole = `workforce_policy_migrator_${roleSuffix}`
const applicationRole = `workforce_policy_app_${roleSuffix}`
const migrationPassword = `PolicyMigration_${roleSuffix}`
const applicationPassword = `PolicyApplication_${roleSuffix}`
const migrationName = "20260927070000_workforce_exception_policy_revision_foundation"
const baselineMigration = "00000000000000_existing_production_schema"
const organizationA = "org-policy-a"
const organizationB = "org-policy-b"

function databaseUrlForRole(role: string, password: string): string {
  const url = new URL(integrationDatabaseUrl)
  url.username = role
  url.password = password
  url.searchParams.set("schema", schema)
  return url.toString()
}

function createMigrationProject(): string {
  const project = mkdtempSync(join(tmpdir(), "workforce-policy-revision-"))
  const prismaDirectory = join(project, "prisma")
  const baselineDirectory = join(
    prismaDirectory,
    "migrations",
    baselineMigration,
  )
  const migrationDirectory = join(
    prismaDirectory,
    "migrations",
    migrationName,
  )
  mkdirSync(baselineDirectory, { recursive: true })
  mkdirSync(migrationDirectory, { recursive: true })
  writeFileSync(join(prismaDirectory, "schema.prisma"), `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
`)
  writeFileSync(
    join(prismaDirectory, "migrations/migration_lock.toml"),
    'provider = "postgresql"\n',
  )
  writeFileSync(
    join(baselineDirectory, "migration.sql"),
    "-- Test-only marker for the pre-existing production schema.\n",
  )
  writeFileSync(
    join(migrationDirectory, "migration.sql"),
    readFileSync(
      join(process.cwd(), "prisma/migrations", migrationName, "migration.sql"),
    ),
  )
  return project
}

function runMigrationCommand(
  project: string,
  args: readonly string[],
): ReturnType<typeof spawnSync> {
  return spawnSync(
    join(process.cwd(), "node_modules/.bin/prisma"),
    [...args, "--schema", join(project, "prisma/schema.prisma")],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrlForRole(migrationLoginRole, migrationPassword),
      },
      encoding: "utf8",
    },
  )
}

async function withOrganization<T>(
  client: PrismaClient,
  organizationId: string,
  action: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(
      "SELECT set_config('app.org_id', $1, true)",
      organizationId,
    )
    return action(tx)
  })
}

async function insertPolicyRevision(
  tx: Prisma.TransactionClient,
  input: {
    id: string
    organizationId: string
    revision?: number
    operationId?: string
    recordedByUserId: string
    definitionHash?: string
  },
): Promise<void> {
  await tx.$executeRawUnsafe(`
    INSERT INTO "workforce_exception_policy_revisions" (
      "id", "organizationId", "revision", "operationId", "policyVersion",
      "definition", "definitionHash", "recordedByUserId", "recordReasonCode"
    ) VALUES ($1, $2, $3, $4, 'recommended-v1', $5::jsonb, $6, $7,
              'OWNER_APPROVED_DRAFT')
  `,
  input.id,
  input.organizationId,
  input.revision ?? 1,
  input.operationId ?? `${input.id}-operation`,
  JSON.stringify(WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_V1),
  input.definitionHash ?? WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_HASH_V1,
  input.recordedByUserId)
}

postgresDescribe("Workforce exception policy revision migration (real PostgreSQL)", () => {
  let observer!: PrismaClient
  let migrationClient!: PrismaClient
  let applicationClient!: PrismaClient
  let migrationProject: string | null = null
  let initialEvidence: {
    revisionRows: number
    legacyPolicyRevisionId: string | null
    decisionConstraintValidated: boolean
  } | null = null

  beforeAll(async () => {
    observer = new PrismaClient({ datasourceUrl: integrationDatabaseUrl })
    await observer.$executeRawUnsafe(
      `CREATE ROLE "${migrationOwnerRole}" NOLOGIN NOSUPERUSER NOBYPASSRLS`,
    )
    await observer.$executeRawUnsafe(
      `CREATE ROLE "${migrationLoginRole}" LOGIN NOSUPERUSER BYPASSRLS PASSWORD '${migrationPassword}'`,
    )
    await observer.$executeRawUnsafe(
      `CREATE ROLE "${applicationRole}" LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${applicationPassword}'`,
    )
    await observer.$executeRawUnsafe(
      `GRANT "${migrationOwnerRole}" TO "${migrationLoginRole}"`,
    )
    for (const role of [migrationLoginRole, applicationRole]) {
      await observer.$executeRawUnsafe(`
        DO $$
        BEGIN
          EXECUTE format(
            'GRANT CONNECT ON DATABASE %I TO %I',
            current_database(),
            '${role}'
          );
        END;
        $$
      `)
    }

    await observer.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
    await observer.$executeRawUnsafe(`
      CREATE TABLE "${schema}"."organizations" (
        "id" TEXT PRIMARY KEY
      )
    `)
    await observer.$executeRawUnsafe(`
      CREATE TABLE "${schema}"."users" (
        "id" TEXT PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        UNIQUE ("organizationId", "id"),
        FOREIGN KEY ("organizationId") REFERENCES "${schema}"."organizations"("id")
          ON DELETE CASCADE
      )
    `)
    await observer.$executeRawUnsafe(`
      CREATE TABLE "${schema}"."mtm_agents" (
        "id" TEXT PRIMARY KEY,
        "organizationId" TEXT NOT NULL
      )
    `)
    await observer.$executeRawUnsafe(`
      CREATE TABLE "${schema}"."workforce_exception_decisions" (
        "id" TEXT PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "caseId" TEXT NOT NULL,
        "caseRevision" INTEGER NOT NULL,
        "operationId" VARCHAR(100) NOT NULL,
        "decisionCode" VARCHAR(64) NOT NULL,
        "reason" VARCHAR(1000) NOT NULL,
        "actorUserId" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE ("organizationId", "id")
      )
    `)
    await observer.$executeRawUnsafe(`
      INSERT INTO "${schema}"."organizations" ("id")
      VALUES ('${organizationA}'), ('${organizationB}')
    `)
    await observer.$executeRawUnsafe(`
      INSERT INTO "${schema}"."users" ("id", "organizationId")
      VALUES
        ('user-policy-a', '${organizationA}'),
        ('user-policy-b', '${organizationB}')
    `)
    await observer.$executeRawUnsafe(`
      INSERT INTO "${schema}"."workforce_exception_decisions" (
        "id", "organizationId", "caseId", "caseRevision", "operationId",
        "decisionCode", "reason", "actorUserId"
      ) VALUES (
        'legacy-decision', '${organizationA}', 'case-policy-a', 1,
        'legacy-operation', 'ACKNOWLEDGE', 'legacy', 'user-policy-a'
      )
    `)

    for (const relation of [
      "organizations",
      "users",
      "workforce_exception_decisions",
    ]) {
      await observer.$executeRawUnsafe(
        `ALTER TABLE "${schema}"."${relation}" OWNER TO "${migrationOwnerRole}"`,
      )
    }
    await observer.$executeRawUnsafe(
      `ALTER TABLE "${schema}"."mtm_agents" OWNER TO "${applicationRole}"`,
    )
    await observer.$executeRawUnsafe(
      `ALTER SCHEMA "${schema}" OWNER TO "${migrationOwnerRole}"`,
    )
    await observer.$executeRawUnsafe(
      `GRANT USAGE ON SCHEMA "${schema}" TO "${applicationRole}"`,
    )
    await observer.$executeRawUnsafe(`
      GRANT SELECT, INSERT ON TABLE
        "${schema}"."workforce_exception_decisions"
      TO "${applicationRole}"
    `)
    await observer.$executeRawUnsafe(`
      ALTER TABLE "${schema}"."workforce_exception_decisions"
      ENABLE ROW LEVEL SECURITY
    `)
    await observer.$executeRawUnsafe(`
      ALTER TABLE "${schema}"."workforce_exception_decisions"
      FORCE ROW LEVEL SECURITY
    `)
    await observer.$executeRawUnsafe(`
      CREATE POLICY workforce_exception_decisions_policy_test
      ON "${schema}"."workforce_exception_decisions"
      FOR ALL
      USING ("organizationId" = current_setting('app.org_id', true))
      WITH CHECK ("organizationId" = current_setting('app.org_id', true))
    `)

    migrationProject = createMigrationProject()
    const baseline = runMigrationCommand(migrationProject, [
      "migrate", "resolve", "--applied", baselineMigration,
    ])
    if (baseline.status !== 0) {
      throw new Error(`Policy revision baseline failed\n${baseline.stdout}\n${baseline.stderr}`)
    }
    const deploy = runMigrationCommand(migrationProject, ["migrate", "deploy"])
    if (deploy.status !== 0) {
      throw new Error(`Policy revision migration failed\n${deploy.stdout}\n${deploy.stderr}`)
    }

    migrationClient = new PrismaClient({
      datasourceUrl: databaseUrlForRole(migrationLoginRole, migrationPassword),
    })
    applicationClient = new PrismaClient({
      datasourceUrl: databaseUrlForRole(applicationRole, applicationPassword),
    })

    const [evidence] = await observer.$queryRawUnsafe<Array<{
      revisionRows: bigint
      legacyPolicyRevisionId: string | null
      decisionConstraintValidated: boolean
    }>>(`
      SELECT
        (SELECT count(*) FROM "${schema}"."workforce_exception_policy_revisions")
          AS "revisionRows",
        (SELECT "policyRevisionId"
           FROM "${schema}"."workforce_exception_decisions"
          WHERE "id" = 'legacy-decision') AS "legacyPolicyRevisionId",
        (SELECT convalidated
           FROM pg_constraint
          WHERE conrelid = '"${schema}"."workforce_exception_decisions"'::regclass
            AND conname = 'workforce_exception_decisions_policy_revision_fk')
          AS "decisionConstraintValidated"
    `)
    initialEvidence = {
      revisionRows: Number(evidence.revisionRows),
      legacyPolicyRevisionId: evidence.legacyPolicyRevisionId,
      decisionConstraintValidated: evidence.decisionConstraintValidated,
    }

    await withOrganization(applicationClient, organizationA, (tx) =>
      insertPolicyRevision(tx, {
        id: "policy-revision-a",
        organizationId: organizationA,
        recordedByUserId: "user-policy-a",
      }))
    await withOrganization(applicationClient, organizationB, (tx) =>
      insertPolicyRevision(tx, {
        id: "policy-revision-b",
        organizationId: organizationB,
        recordedByUserId: "user-policy-b",
      }))
  }, 60_000)

  afterAll(async () => {
    await Promise.all([
      migrationClient?.$disconnect().catch(() => {}),
      applicationClient?.$disconnect().catch(() => {}),
    ])
    await observer?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {})
    for (const role of [applicationRole, migrationLoginRole, migrationOwnerRole]) {
      await observer?.$executeRawUnsafe(`DROP OWNED BY "${role}"`).catch(() => {})
      await observer?.$executeRawUnsafe(`DROP ROLE IF EXISTS "${role}"`).catch(() => {})
    }
    await observer?.$disconnect().catch(() => {})
    if (migrationProject) rmSync(migrationProject, { recursive: true, force: true })
  })

  it("applies empty and preserves honest legacy null provenance", async () => {
    expect(initialEvidence).toEqual({
      revisionRows: 0,
      legacyPolicyRevisionId: null,
      decisionConstraintValidated: false,
    })
    const [state] = await observer.$queryRawUnsafe<Array<{
      rowSecurity: boolean
      forceRowSecurity: boolean
      applicationCanSelect: boolean
      applicationCanInsert: boolean
      applicationCanUpdate: boolean
      applicationCanDelete: boolean
    }>>(`
      SELECT relation.relrowsecurity AS "rowSecurity",
             relation.relforcerowsecurity AS "forceRowSecurity",
             has_table_privilege($1,
               '"${schema}"."workforce_exception_policy_revisions"', 'SELECT')
               AS "applicationCanSelect",
             has_table_privilege($1,
               '"${schema}"."workforce_exception_policy_revisions"', 'INSERT')
               AS "applicationCanInsert",
             has_table_privilege($1,
               '"${schema}"."workforce_exception_policy_revisions"', 'UPDATE')
               AS "applicationCanUpdate",
             has_table_privilege($1,
               '"${schema}"."workforce_exception_policy_revisions"', 'DELETE')
               AS "applicationCanDelete"
        FROM pg_class relation
       WHERE relation.oid = '"${schema}"."workforce_exception_policy_revisions"'::regclass
    `, applicationRole)
    expect(state).toEqual({
      rowSecurity: true,
      forceRowSecurity: true,
      applicationCanSelect: true,
      applicationCanInsert: true,
      applicationCanUpdate: false,
      applicationCanDelete: false,
    })
  })

  it("enforces tenant RLS and composite actor ownership", async () => {
    const visibleA = await withOrganization(applicationClient, organizationA, (tx) =>
      tx.$queryRawUnsafe<Array<{ id: string }>>(`
        SELECT "id" FROM "workforce_exception_policy_revisions" ORDER BY "id"
      `))
    expect(visibleA).toEqual([{ id: "policy-revision-a" }])

    await expect(withOrganization(applicationClient, organizationA, (tx) =>
      insertPolicyRevision(tx, {
        id: "policy-revision-rls-rejected",
        organizationId: organizationB,
        revision: 2,
        recordedByUserId: "user-policy-b",
      }))).rejects.toBeDefined()

    await expect(withOrganization(applicationClient, organizationA, (tx) =>
      insertPolicyRevision(tx, {
        id: "policy-revision-actor-rejected",
        organizationId: organizationA,
        revision: 2,
        recordedByUserId: "user-policy-b",
      }))).rejects.toBeDefined()
  })

  it("keeps old decision inserts compatible and enforces tenant policy links", async () => {
    const legacy = await withOrganization(applicationClient, organizationA, (tx) =>
      tx.$queryRawUnsafe<Array<{ policyRevisionId: string | null }>>(`
        INSERT INTO "workforce_exception_decisions" (
          "id", "organizationId", "caseId", "caseRevision", "operationId",
          "decisionCode", "reason", "actorUserId"
        ) VALUES (
          'old-binary-decision', '${organizationA}', 'case-policy-a', 2,
          'old-binary-operation', 'ACKNOWLEDGE', 'old binary', 'user-policy-a'
        ) RETURNING "policyRevisionId"
      `))
    expect(legacy).toEqual([{ policyRevisionId: null }])

    const linked = await withOrganization(applicationClient, organizationA, (tx) =>
      tx.$queryRawUnsafe<Array<{ policyRevisionId: string }>>(`
        INSERT INTO "workforce_exception_decisions" (
          "id", "organizationId", "caseId", "caseRevision", "operationId",
          "decisionCode", "reason", "policyRevisionId", "actorUserId"
        ) VALUES (
          'policy-linked-decision', '${organizationA}', 'case-policy-a', 3,
          'policy-linked-operation', 'ACKNOWLEDGE', 'linked',
          'policy-revision-a', 'user-policy-a'
        ) RETURNING "policyRevisionId"
      `))
    expect(linked).toEqual([{ policyRevisionId: "policy-revision-a" }])

    await expect(withOrganization(applicationClient, organizationA, (tx) =>
      tx.$executeRawUnsafe(`
        INSERT INTO "workforce_exception_decisions" (
          "id", "organizationId", "caseId", "caseRevision", "operationId",
          "decisionCode", "reason", "policyRevisionId", "actorUserId"
        ) VALUES (
          'cross-tenant-policy-decision', '${organizationA}', 'case-policy-a', 4,
          'cross-tenant-policy-operation', 'ACKNOWLEDGE', 'cross tenant',
          'policy-revision-b', 'user-policy-a'
        )
      `))).rejects.toBeDefined()
  })

  it("rejects owner-level update, delete and table clearing", async () => {
    await expect(migrationClient.$executeRawUnsafe(`
      UPDATE "workforce_exception_policy_revisions"
         SET "recordReasonCode" = 'MUTATED'
       WHERE "id" = 'policy-revision-a'
    `)).rejects.toBeDefined()
    await expect(migrationClient.$executeRawUnsafe(`
      DELETE FROM "workforce_exception_policy_revisions"
       WHERE "id" = 'policy-revision-a'
    `)).rejects.toBeDefined()
    await expect(migrationClient.$executeRawUnsafe(
      'TRUNCATE TABLE "workforce_exception_policy_revisions"',
    )).rejects.toBeDefined()

    const [remaining] = await observer.$queryRawUnsafe<Array<{ count: bigint }>>(`
      SELECT count(*) AS "count"
        FROM "${schema}"."workforce_exception_policy_revisions"
    `)
    expect(Number(remaining.count)).toBe(2)
  })
})
