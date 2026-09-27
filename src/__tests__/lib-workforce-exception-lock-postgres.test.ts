import { randomUUID } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { Prisma, PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { lockMtmWorkdayTransitions } from "@/lib/mtm/workday"
import {
  lockWorkforceExceptionDecisionOperation,
  lockWorkforceExceptionDecisionStream,
} from "@/lib/workforce/exception-case-writer"
import type { WorkforceExceptionEmployeeResponseDraft } from "@/lib/workforce/exception-employee-response"
import {
  appendAuthorizedWorkforceExceptionEmployeeResponse,
  type WorkforceExceptionEmployeeResponseWriterDb,
} from "@/lib/workforce/exception-employee-response-writer"
import {
  lockWorkforceExceptionLinkedMutation,
  type WorkforceExceptionLinkedMutationDb,
} from "@/lib/workforce/exception-linked-mutation"
import { lockWorkforceHrmRequestClientKey } from "@/lib/workforce/hrm-request-idempotency"

const databaseUrl = process.env.WORKFORCE_EXCEPTION_LOCK_TEST_DATABASE_URL
const integrationDatabaseUrl = databaseUrl ?? "postgresql://disabled:disabled@127.0.0.1:1/disabled"
const postgresDescribe = databaseUrl ? describe : describe.skip
const schema = `workforce_exception_lock_${randomUUID().replaceAll("-", "")}`
const roleSuffix = randomUUID().replaceAll("-", "").slice(0, 20)
const migrationOwnerRole = `workforce_revision_owner_${roleSuffix}`
const migrationLoginRole = `workforce_revision_migrator_${roleSuffix}`
const migrationLoginPassword = `Revision_${randomUUID().replaceAll("-", "")}`
const organizationId = "org-workforce-lock-proof"
const revisionMigrationNames = [
  "20260927014000_workforce_exception_case_revisions",
  "20260927014100_workforce_exception_case_revisions_backfill",
  "20260927014200_workforce_exception_case_revisions_indexes",
  "20260927014300_workforce_exception_case_revisions_contract",
] as const
const revisionIndexMigration = revisionMigrationNames[2]

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}

function databaseUrlForRole(role: string, password: string): string {
  const url = new URL(integrationDatabaseUrl)
  url.username = role
  url.password = password
  return url.toString()
}

function migrationDatabaseUrl(): string {
  const url = new URL(databaseUrlForRole(migrationLoginRole, migrationLoginPassword))
  url.searchParams.set("schema", schema)
  return url.toString()
}

function runPrismaMigrationCommand(
  migrationProject: string,
  args: readonly string[],
): ReturnType<typeof spawnSync> {
  return spawnSync(
    join(process.cwd(), "node_modules/.bin/prisma"),
    [...args, "--schema", join(migrationProject, "prisma/schema.prisma")],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: migrationDatabaseUrl() },
      encoding: "utf8",
    },
  )
}

function addExactMigrationToProject(migrationProject: string, migrationName: string): void {
  const target = join(migrationProject, "prisma/migrations", migrationName)
  mkdirSync(target, { recursive: true })
  writeFileSync(
    join(target, "migration.sql"),
    readFileSync(join(process.cwd(), "prisma/migrations", migrationName, "migration.sql")),
  )
}

function createMigrationProject(): string {
  const migrationProject = mkdtempSync(join(tmpdir(), "workforce-revision-migrations-"))
  const prismaDirectory = join(migrationProject, "prisma")
  mkdirSync(join(prismaDirectory, "migrations"), { recursive: true })
  writeFileSync(join(prismaDirectory, "schema.prisma"), `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
`)
  writeFileSync(join(prismaDirectory, "migrations/migration_lock.toml"), 'provider = "postgresql"\n')
  return migrationProject
}

postgresDescribe("Workforce exception shared lock (real PostgreSQL)", () => {
  let observer!: PrismaClient
  let terminalClient!: PrismaClient
  let linkedClient!: PrismaClient
  let migrationProject: string | null = null
  let migrationRecoveryEvidence: {
    failedIndexLedgerRows: number
    invalidIndexesAfterFailure: number
    successfulRevisionMigrations: number
  } | null = null

  beforeAll(async () => {
    observer = new PrismaClient({ datasourceUrl: integrationDatabaseUrl })
    terminalClient = new PrismaClient({ datasourceUrl: integrationDatabaseUrl })
    linkedClient = new PrismaClient({ datasourceUrl: integrationDatabaseUrl })
    await observer.$executeRawUnsafe(`
      CREATE ROLE "${migrationOwnerRole}" NOLOGIN NOSUPERUSER NOBYPASSRLS
    `)
    await observer.$executeRawUnsafe(`
      CREATE ROLE "${migrationLoginRole}"
      LOGIN NOSUPERUSER BYPASSRLS PASSWORD '${migrationLoginPassword}'
    `)
    await observer.$executeRawUnsafe(`
      GRANT "${migrationOwnerRole}" TO "${migrationLoginRole}"
    `)
    await observer.$executeRawUnsafe(`
      DO $$
      BEGIN
        EXECUTE format(
          'GRANT CONNECT ON DATABASE %I TO %I',
          current_database(),
          '${migrationLoginRole}'
        );
      END;
      $$
    `)
    await observer.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
    await observer.$executeRawUnsafe(`
      CREATE TABLE "${schema}"."case_decisions" (
        "organization_id" TEXT NOT NULL,
        "case_id" TEXT NOT NULL,
        "decisions" JSONB NOT NULL DEFAULT '[]'::jsonb,
        "last_decision_created_at" TIMESTAMPTZ,
        PRIMARY KEY ("organization_id", "case_id")
      )
    `)
    await observer.$executeRawUnsafe(`
      CREATE TABLE "${schema}"."linked_mutations" (
        "organization_id" TEXT NOT NULL,
        "case_id" TEXT NOT NULL,
        "mutation_count" INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY ("organization_id", "case_id")
      )
    `)
    await observer.$executeRawUnsafe(`
      CREATE TABLE "${schema}"."linked_requests" (
        "organization_id" TEXT NOT NULL,
        "agent_id" TEXT NOT NULL DEFAULT 'agent-lock-proof',
        "case_id" TEXT NOT NULL,
        "client_request_id" TEXT NOT NULL,
        "status" TEXT NOT NULL,
        PRIMARY KEY ("organization_id", "agent_id", "client_request_id")
      )
    `)
    await observer.$executeRawUnsafe(`
      CREATE TABLE "${schema}"."employee_responses" (
        "id" TEXT PRIMARY KEY,
        "organization_id" TEXT NOT NULL,
        "case_id" TEXT NOT NULL,
        "agent_id" TEXT NOT NULL,
        "workday_id" TEXT NOT NULL,
        "segment_id" TEXT,
        "correction_request_id" TEXT,
        "response_code" TEXT NOT NULL,
        "client_response_id" TEXT NOT NULL,
        "actor_user_id" TEXT NOT NULL,
        "observed_case_revision" INTEGER,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE ("organization_id", "agent_id", "client_response_id")
      )
    `)
    await observer.$executeRawUnsafe(`
      CREATE TABLE "${schema}"."decision_operations" (
        "organization_id" TEXT NOT NULL,
        "case_id" TEXT NOT NULL,
        "operation_id" TEXT NOT NULL,
        PRIMARY KEY ("organization_id", "operation_id")
      )
    `)
    await observer.$executeRawUnsafe(`
      CREATE TABLE "${schema}"."workforce_exception_cases" (
        "id" TEXT NOT NULL,
        "organizationId" TEXT NOT NULL,
        "agentId" TEXT NOT NULL,
        "workdayId" TEXT,
        "segmentId" TEXT,
        PRIMARY KEY ("id"),
        UNIQUE ("organizationId", "id")
      )
    `)
    await observer.$executeRawUnsafe(`
      CREATE TABLE "${schema}"."mtm_agents" (
        "id" TEXT NOT NULL,
        "organizationId" TEXT NOT NULL,
        "userId" TEXT,
        PRIMARY KEY ("id")
      )
    `)
    await observer.$executeRawUnsafe(`
      CREATE TABLE "${schema}"."mtm_hrm_requests" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "agentId" TEXT NOT NULL,
        "type" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'PENDING',
        "correctionWorkdayId" TEXT,
        "exceptionCaseId" TEXT,
        "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await observer.$executeRawUnsafe(`
      CREATE TABLE "${schema}"."workforce_exception_decisions" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "caseId" TEXT NOT NULL,
        "operationId" TEXT NOT NULL,
        "decisionCode" TEXT NOT NULL,
        "reason" TEXT NOT NULL,
        "actorUserId" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await observer.$executeRawUnsafe(`
      CREATE TABLE "${schema}"."workforce_exception_employee_responses" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "caseId" TEXT NOT NULL,
        "agentId" TEXT NOT NULL,
        "workdayId" TEXT NOT NULL,
        "segmentId" TEXT,
        "correctionRequestId" TEXT,
        "responseCode" TEXT NOT NULL,
        "clientResponseId" TEXT NOT NULL,
        "actorUserId" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await observer.$executeRawUnsafe(`
      CREATE FUNCTION "${schema}".workforce_reject_exception_decision_mutation()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'Workforce exception decisions are append-only' USING ERRCODE = '55000';
      END;
      $$
    `)
    await observer.$executeRawUnsafe(`
      CREATE TRIGGER workforce_exception_decisions_append_only
      BEFORE UPDATE OR DELETE ON "${schema}"."workforce_exception_decisions"
      FOR EACH ROW EXECUTE FUNCTION "${schema}".workforce_reject_exception_decision_mutation()
    `)
    await observer.$executeRawUnsafe(`
      CREATE FUNCTION "${schema}".workforce_validate_exception_employee_response_insert()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$
    `)
    await observer.$executeRawUnsafe(`
      CREATE TRIGGER workforce_exception_employee_responses_validate_insert
      BEFORE INSERT ON "${schema}"."workforce_exception_employee_responses"
      FOR EACH ROW EXECUTE FUNCTION "${schema}".workforce_validate_exception_employee_response_insert()
    `)
    await observer.$executeRawUnsafe(`
      CREATE FUNCTION "${schema}".workforce_validate_hrm_request_exception_link()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$
    `)
    await observer.$executeRawUnsafe(`
      CREATE TRIGGER workforce_hrm_requests_validate_exception_link
      BEFORE INSERT OR UPDATE ON "${schema}"."mtm_hrm_requests"
      FOR EACH ROW EXECUTE FUNCTION "${schema}".workforce_validate_hrm_request_exception_link()
    `)
    await observer.$executeRawUnsafe(`
      INSERT INTO "${schema}"."workforce_exception_cases" (
        "id", "organizationId", "agentId", "workdayId", "segmentId"
      ) VALUES
        ('migration-case', $1, 'migration-agent', 'migration-workday', 'migration-segment'),
        ('migration-other-case', $1, 'migration-agent', 'migration-workday', 'migration-segment')
    `, organizationId)
    await observer.$executeRawUnsafe(`
      INSERT INTO "${schema}"."mtm_agents" ("id", "organizationId", "userId")
      VALUES ('migration-agent', $1, 'migration-user')
    `, organizationId)
    await observer.$executeRawUnsafe(`
      INSERT INTO "${schema}"."workforce_exception_decisions" (
        "id", "organizationId", "caseId", "operationId", "decisionCode",
        "reason", "actorUserId", "createdAt"
      ) VALUES
        ('migration-decision-b', $1, 'migration-case', 'migration-op-b', 'ACKNOWLEDGE', 'b', 'manager', '2026-09-01T09:00:00Z'),
        ('migration-decision-a', $1, 'migration-case', 'migration-op-a', 'ACKNOWLEDGE', 'a', 'manager', '2026-09-01T09:00:00Z'),
        ('migration-decision-c', $1, 'migration-case', 'migration-op-c', 'REQUEST_EMPLOYEE_RESPONSE', 'c', 'manager', '2026-09-01T10:00:00Z')
    `, organizationId)
    await observer.$executeRawUnsafe(`
      INSERT INTO "${schema}"."mtm_hrm_requests" (
        "id", "organizationId", "agentId", "type", "correctionWorkdayId",
        "exceptionCaseId", "submittedAt"
      ) VALUES ('migration-request-pre-expansion', $1, 'migration-agent',
                'TIME_CORRECTION', 'migration-workday', 'migration-case',
                '2026-09-01T10:30:00Z')
    `, organizationId)
    await observer.$executeRawUnsafe(`
      INSERT INTO "${schema}"."workforce_exception_employee_responses" (
        "id", "organizationId", "caseId", "agentId", "workdayId", "segmentId",
        "correctionRequestId", "responseCode", "clientResponseId", "actorUserId",
        "createdAt"
      ) VALUES ('migration-response-pre-expansion', $1, 'migration-case',
                'migration-agent', 'migration-workday', 'migration-segment', NULL,
                'ACKNOWLEDGED', 'migration-response-pre-expansion', 'migration-user',
                '2026-09-01T10:45:00Z')
    `, organizationId)

    // Match production's ownership contract: the login that applies the
    // migration is not superuser, has BYPASSRLS, and only inherits DDL rights
    // through membership in the relation-owner role.
    for (const relation of [
      "workforce_exception_cases",
      "mtm_agents",
      "mtm_hrm_requests",
      "workforce_exception_decisions",
      "workforce_exception_employee_responses",
    ]) {
      await observer.$executeRawUnsafe(`
        ALTER TABLE "${schema}"."${relation}" OWNER TO "${migrationOwnerRole}"
      `)
    }
    for (const routine of [
      "workforce_reject_exception_decision_mutation",
      "workforce_validate_exception_employee_response_insert",
      "workforce_validate_hrm_request_exception_link",
    ]) {
      await observer.$executeRawUnsafe(`
        ALTER FUNCTION "${schema}"."${routine}"() OWNER TO "${migrationOwnerRole}"
      `)
    }
    await observer.$executeRawUnsafe(`ALTER SCHEMA "${schema}" OWNER TO "${migrationOwnerRole}"`)
    await observer.$executeRawUnsafe(`
      ALTER TABLE "${schema}"."workforce_exception_decisions"
      ENABLE ROW LEVEL SECURITY
    `)
    await observer.$executeRawUnsafe(`
      ALTER TABLE "${schema}"."workforce_exception_decisions"
      FORCE ROW LEVEL SECURITY
    `)
    await observer.$executeRawUnsafe(`
      CREATE POLICY workforce_exception_decisions_migration_fidelity
      ON "${schema}"."workforce_exception_decisions"
      FOR ALL
      USING (
        "organizationId" = current_setting('app.org_id', true)
        OR current_setting('app.rls_bypass', true) = 'on'
      )
      WITH CHECK (
        "organizationId" = current_setting('app.org_id', true)
        OR current_setting('app.rls_bypass', true) = 'on'
      )
    `)
    migrationProject = createMigrationProject()
    addExactMigrationToProject(migrationProject, revisionMigrationNames[0])
    const expandDeploy = runPrismaMigrationCommand(migrationProject, ["migrate", "deploy"])
    if (expandDeploy.status !== 0) {
      throw new Error(
        `Workforce revision expansion migration failed\n${expandDeploy.stdout}\n${expandDeploy.stderr}`,
      )
    }

    // Exercise the real rolling window: the old binary can still write after
    // expansion commits but before the separately tracked backfill starts. Its
    // omitted revision must bind to all three still-NULL legacy decisions, and
    // its timestamp must remain causally ordered for the draining old reader.
    await observer.$transaction(async (tx) => {
      await useMigrationSchema(tx)
      await tx.$executeRawUnsafe(`
        INSERT INTO "${schema}"."mtm_hrm_requests" (
          "id", "organizationId", "agentId", "type", "correctionWorkdayId",
          "exceptionCaseId"
        ) VALUES ('migration-request-expand-window', $1, 'migration-agent',
                  'TIME_CORRECTION', 'migration-workday', 'migration-case')
      `, organizationId)
      await tx.$executeRawUnsafe(`
        INSERT INTO "${schema}"."workforce_exception_employee_responses" (
          "id", "organizationId", "caseId", "agentId", "workdayId", "segmentId",
          "correctionRequestId", "responseCode", "clientResponseId", "actorUserId"
        ) VALUES ('migration-response-expand-window', $1, 'migration-case',
                  'migration-agent', 'migration-workday', 'migration-segment', NULL,
                  'ACKNOWLEDGED', 'migration-response-expand-window', 'migration-user')
      `, organizationId)
    })

    addExactMigrationToProject(migrationProject, revisionMigrationNames[1])
    const backfillDeploy = runPrismaMigrationCommand(migrationProject, ["migrate", "deploy"])
    if (backfillDeploy.status !== 0) {
      throw new Error(
        `Workforce revision backfill migration failed\n${backfillDeploy.stdout}\n${backfillDeploy.stderr}`,
      )
    }

    // Force the exact online-index migration to leave its documented invalid
    // artifact. The separately tracked expansion/backfill must remain applied,
    // while the restartable index phase is resolved and replayed after the
    // duplicate is removed.
    await observer.$executeRawUnsafe(`
      ALTER TABLE "${schema}"."workforce_exception_decisions"
      DISABLE TRIGGER workforce_exception_decisions_assign_case_revision
    `)
    await observer.$executeRawUnsafe(`
      INSERT INTO "${schema}"."workforce_exception_decisions" (
        "id", "organizationId", "caseId", "operationId", "decisionCode",
        "reason", "actorUserId", "createdAt", "caseRevision"
      ) VALUES ('migration-recovery-duplicate', $1, 'migration-case',
                'migration-recovery-duplicate', 'ACKNOWLEDGE', 'duplicate',
                'manager', CURRENT_TIMESTAMP, 1)
    `, organizationId)
    await observer.$executeRawUnsafe(`
      ALTER TABLE "${schema}"."workforce_exception_decisions"
      ENABLE TRIGGER workforce_exception_decisions_assign_case_revision
    `)
    for (const migrationName of revisionMigrationNames.slice(2)) {
      addExactMigrationToProject(migrationProject, migrationName)
    }
    const expectedIndexFailure = runPrismaMigrationCommand(migrationProject, ["migrate", "deploy"])
    if (expectedIndexFailure.status === 0) {
      throw new Error("Workforce revision index migration unexpectedly accepted a duplicate revision")
    }
    const [failedState] = await observer.$queryRawUnsafe<Array<{
      failedIndexLedgerRows: bigint
      invalidIndexesAfterFailure: bigint
    }>>(`
      SELECT
        (SELECT count(*)
           FROM "${schema}"."_prisma_migrations"
          WHERE migration_name = $1
            AND finished_at IS NULL
            AND rolled_back_at IS NULL) AS "failedIndexLedgerRows",
        (SELECT count(*)
           FROM pg_index index_state
           JOIN pg_class index_relation ON index_relation.oid = index_state.indexrelid
           JOIN pg_namespace namespace ON namespace.oid = index_relation.relnamespace
          WHERE namespace.nspname = $2
            AND index_relation.relname = 'workforce_exception_decisions_org_case_revision_key'
            AND NOT index_state.indisvalid) AS "invalidIndexesAfterFailure"
    `, revisionIndexMigration, schema)
    migrationRecoveryEvidence = {
      failedIndexLedgerRows: Number(failedState.failedIndexLedgerRows),
      invalidIndexesAfterFailure: Number(failedState.invalidIndexesAfterFailure),
      successfulRevisionMigrations: 0,
    }
    if (migrationRecoveryEvidence.failedIndexLedgerRows !== 1
      || migrationRecoveryEvidence.invalidIndexesAfterFailure !== 1) {
      throw new Error(`Unexpected Workforce revision failure state: ${JSON.stringify(migrationRecoveryEvidence)}`)
    }

    await observer.$executeRawUnsafe(`
      ALTER TABLE "${schema}"."workforce_exception_decisions"
      DISABLE TRIGGER workforce_exception_decisions_append_only
    `)
    await observer.$executeRawUnsafe(`
      DELETE FROM "${schema}"."workforce_exception_decisions"
       WHERE "id" = 'migration-recovery-duplicate'
    `)
    await observer.$executeRawUnsafe(`
      ALTER TABLE "${schema}"."workforce_exception_decisions"
      ENABLE TRIGGER workforce_exception_decisions_append_only
    `)
    const resolve = runPrismaMigrationCommand(migrationProject, [
      "migrate", "resolve", "--rolled-back", revisionIndexMigration,
    ])
    if (resolve.status !== 0) {
      throw new Error(`Workforce revision index resolve failed\n${resolve.stdout}\n${resolve.stderr}`)
    }
    const recoveryDeploy = runPrismaMigrationCommand(migrationProject, ["migrate", "deploy"])
    if (recoveryDeploy.status !== 0) {
      throw new Error(
        `Workforce revision migration recovery failed\n${recoveryDeploy.stdout}\n${recoveryDeploy.stderr}`,
      )
    }
    const [finalLedger] = await observer.$queryRawUnsafe<Array<{
      successfulRevisionMigrations: bigint
      unresolvedRevisionMigrations: bigint
    }>>(`
      SELECT
        count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)
          AS "successfulRevisionMigrations",
        count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)
          AS "unresolvedRevisionMigrations"
        FROM "${schema}"."_prisma_migrations"
       WHERE migration_name = ANY($1::TEXT[])
    `, [...revisionMigrationNames])
    migrationRecoveryEvidence.successfulRevisionMigrations = Number(
      finalLedger.successfulRevisionMigrations,
    )
    if (migrationRecoveryEvidence.successfulRevisionMigrations !== revisionMigrationNames.length
      || Number(finalLedger.unresolvedRevisionMigrations) !== 0) {
      throw new Error(`Incomplete Workforce revision recovery ledger: ${JSON.stringify(finalLedger)}`)
    }
  }, 90_000)

  afterAll(async () => {
    await observer?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {})
    await observer?.$executeRawUnsafe(`DROP OWNED BY "${migrationLoginRole}"`).catch(() => {})
    await observer?.$executeRawUnsafe(`DROP ROLE IF EXISTS "${migrationLoginRole}"`).catch(() => {})
    await observer?.$executeRawUnsafe(`DROP OWNED BY "${migrationOwnerRole}"`).catch(() => {})
    await observer?.$executeRawUnsafe(`DROP ROLE IF EXISTS "${migrationOwnerRole}"`).catch(() => {})
    await Promise.all([
      observer?.$disconnect(),
      terminalClient?.$disconnect(),
      linkedClient?.$disconnect(),
    ])
    if (migrationProject) rmSync(migrationProject, { recursive: true, force: true })
  })

  function linkedMutationDb(tx: Prisma.TransactionClient): WorkforceExceptionLinkedMutationDb {
    return {
      $executeRaw: tx.$executeRaw.bind(tx) as WorkforceExceptionLinkedMutationDb["$executeRaw"],
      workforceExceptionDecision: {
        findMany: async (args) => {
          const rows = await tx.$queryRawUnsafe<Array<{ decisions: string[] }>>(`
            SELECT "decisions"
              FROM "${schema}"."case_decisions"
             WHERE "organization_id" = $1 AND "case_id" = $2
          `, args.where.organizationId, args.where.caseId)
          return (rows[0]?.decisions ?? [])
            .slice(0, args.take)
            .map((decisionCode, index) => ({ decisionCode, caseRevision: index + 1 }))
        },
      },
    }
  }

  function employeeResponseDb(
    tx: Prisma.TransactionClient,
    hooks: {
      onCreate?: () => void | Promise<void>
      onAudit?: () => void | Promise<void>
    } = {},
  ): WorkforceExceptionEmployeeResponseWriterDb {
    const linkedDb = linkedMutationDb(tx)
    return {
      ...linkedDb,
      workforceExceptionEmployeeResponse: {
        findFirst: async (args) => {
          const rows = await tx.$queryRawUnsafe<Array<WorkforceExceptionEmployeeResponseDraft & { id: string }>>(`
            SELECT "id",
                   "organization_id" AS "organizationId",
                   "case_id" AS "caseId",
                   "agent_id" AS "agentId",
                   "workday_id" AS "workdayId",
                   "segment_id" AS "segmentId",
                   "correction_request_id" AS "correctionRequestId",
                   "response_code" AS "responseCode",
                   "client_response_id" AS "clientResponseId",
                   "actor_user_id" AS "actorUserId"
              FROM "${schema}"."employee_responses"
             WHERE "organization_id" = $1
               AND "agent_id" = $2
               AND "client_response_id" = $3
          `, args.where.organizationId, args.where.agentId, args.where.clientResponseId)
          return rows[0] ?? null
        },
        create: async ({ data }) => {
          await hooks.onCreate?.()
          const id = `response-${randomUUID()}`
          await tx.$executeRawUnsafe(`
            INSERT INTO "${schema}"."employee_responses" (
              "id", "organization_id", "case_id", "agent_id", "workday_id",
              "segment_id", "correction_request_id", "response_code",
              "client_response_id", "actor_user_id", "observed_case_revision"
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          `,
          id,
          data.organizationId,
          data.caseId,
          data.agentId,
          data.workdayId,
          data.segmentId,
          data.correctionRequestId,
          data.responseCode,
          data.clientResponseId,
          data.actorUserId,
          data.observedCaseRevision)
          return { id, ...data }
        },
      },
      mtmHrmRequest: {
        // Current real-race drafts acknowledge directly and therefore never
        // carry a correction request. Exact request/case topology is covered
        // below against the migrated PostgreSQL trigger itself.
        findFirst: async () => null,
      },
      mtmAuditLog: {
        create: async () => {
          await hooks.onAudit?.()
          return { id: `audit-${randomUUID()}` }
        },
      },
    }
  }

  async function configureBoundedTransaction(tx: Prisma.TransactionClient): Promise<void> {
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'")
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '7s'")
  }

  async function waitForAdvisoryLockWait(pid: number): Promise<void> {
    const deadline = Date.now() + 3_000
    while (Date.now() < deadline) {
      const rows = await observer.$queryRawUnsafe<Array<{
        wait_event_type: string | null
        wait_event: string | null
      }>>(`
        SELECT wait_event_type, wait_event
          FROM pg_stat_activity
         WHERE pid = $1
      `, pid)
      if (rows[0]?.wait_event_type === "Lock" && rows[0]?.wait_event === "advisory") return
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error(`backend ${pid} did not wait on the shared advisory lock`)
  }

  async function useMigrationSchema(tx: Prisma.TransactionClient): Promise<void> {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`)
    await configureBoundedTransaction(tx)
  }

  async function readState(caseId: string): Promise<{
    decisions: string[]
    linked_mutation_count: number
  }> {
    const rows = await observer.$queryRawUnsafe<Array<{
      decisions: string[]
      linked_mutation_count: number
    }>>(`
      SELECT decisions."decisions",
             mutations."mutation_count" AS "linked_mutation_count"
        FROM "${schema}"."case_decisions" decisions
        JOIN "${schema}"."linked_mutations" mutations
          ON mutations."organization_id" = decisions."organization_id"
         AND mutations."case_id" = decisions."case_id"
       WHERE decisions."organization_id" = $1 AND decisions."case_id" = $2
    `, organizationId, caseId)
    if (!rows[0]) throw new Error("missing Workforce lock proof state")
    return rows[0]
  }

  it("applies the exact revision migration to a non-empty append-only ledger", async () => {
    expect(migrationRecoveryEvidence).toEqual({
      failedIndexLedgerRows: 1,
      invalidIndexesAfterFailure: 1,
      successfulRevisionMigrations: 4,
    })
    const [migrationRole] = await observer.$queryRawUnsafe<Array<{
      rolsuper: boolean
      rolbypassrls: boolean
      rolcanlogin: boolean
      ownsByMembership: boolean
    }>>(`
      SELECT login.rolsuper,
             login.rolbypassrls,
             login.rolcanlogin,
             pg_has_role(login.oid, owner.oid, 'MEMBER') AS "ownsByMembership"
        FROM pg_roles login
        JOIN pg_roles owner ON owner.rolname = $2
       WHERE login.rolname = $1
    `, migrationLoginRole, migrationOwnerRole)
    expect(migrationRole).toEqual({
      rolsuper: false,
      rolbypassrls: true,
      rolcanlogin: true,
      ownsByMembership: true,
    })
    const [rlsState] = await observer.$queryRawUnsafe<Array<{
      relrowsecurity: boolean
      relforcerowsecurity: boolean
    }>>(`
      SELECT relrowsecurity, relforcerowsecurity
        FROM pg_class
       WHERE oid = '"${schema}"."workforce_exception_decisions"'::regclass
    `)
    expect(rlsState).toEqual({ relrowsecurity: true, relforcerowsecurity: true })

    const backfilled = await observer.$queryRawUnsafe<Array<{ id: string; caseRevision: number }>>(`
      SELECT "id", "caseRevision"
        FROM "${schema}"."workforce_exception_decisions"
       WHERE "organizationId" = $1 AND "caseId" = 'migration-case'
       ORDER BY "caseRevision" ASC
    `, organizationId)
    expect(backfilled).toEqual([
      { id: "migration-decision-a", caseRevision: 1 },
      { id: "migration-decision-b", caseRevision: 2 },
      { id: "migration-decision-c", caseRevision: 3 },
    ])
    const [legacySignals] = await observer.$queryRawUnsafe<Array<{
      observedCaseRevision: number | null
      exceptionCaseRevision: number | null
    }>>(`
      SELECT response."observedCaseRevision",
             request."exceptionCaseRevision"
        FROM "${schema}"."workforce_exception_employee_responses" response
        JOIN "${schema}"."mtm_hrm_requests" request
          ON request."id" = 'migration-request-pre-expansion'
       WHERE response."id" = 'migration-response-pre-expansion'
    `)
    expect(legacySignals).toEqual({
      observedCaseRevision: null,
      exceptionCaseRevision: null,
    })
    const [expandWindowSignals] = await observer.$queryRawUnsafe<Array<{
      observedCaseRevision: number
      responseCreatedAt: Date
      exceptionCaseRevision: number
      requestSubmittedAt: Date
      previousDecisionCreatedAt: Date
    }>>(`
      SELECT response."observedCaseRevision",
             response."createdAt" AS "responseCreatedAt",
             request."exceptionCaseRevision",
             request."submittedAt" AS "requestSubmittedAt",
             (
               SELECT MAX(decision."createdAt")
                 FROM "${schema}"."workforce_exception_decisions" decision
                WHERE decision."organizationId" = $1
                  AND decision."caseId" = 'migration-case'
             ) AS "previousDecisionCreatedAt"
        FROM "${schema}"."workforce_exception_employee_responses" response
        JOIN "${schema}"."mtm_hrm_requests" request
          ON request."id" = 'migration-request-expand-window'
       WHERE response."id" = 'migration-response-expand-window'
    `, organizationId)
    expect(expandWindowSignals.observedCaseRevision).toBe(3)
    expect(expandWindowSignals.exceptionCaseRevision).toBe(3)
    expect(expandWindowSignals.requestSubmittedAt.getTime())
      .toBeGreaterThan(expandWindowSignals.previousDecisionCreatedAt.getTime())
    expect(expandWindowSignals.responseCreatedAt.getTime())
      .toBeGreaterThan(expandWindowSignals.requestSubmittedAt.getTime())

    // The named append-only guard is active again after the controlled
    // backfill window.
    await expect(observer.$transaction(async (tx) => {
      await useMigrationSchema(tx)
      await tx.$executeRawUnsafe(`
        UPDATE "${schema}"."workforce_exception_decisions"
           SET "reason" = 'mutated'
         WHERE "id" = 'migration-decision-a'
      `)
    })).rejects.toBeDefined()

    // A draining pre-cutover binary omits the new column. The compatibility
    // trigger assigns the exact next revision under the same case lock.
    const oldClientInsert = await observer.$transaction(async (tx) => {
      await useMigrationSchema(tx)
      return tx.$queryRawUnsafe<Array<{ caseRevision: number }>>(`
        INSERT INTO "${schema}"."workforce_exception_decisions" (
          "id", "organizationId", "caseId", "operationId", "decisionCode", "reason", "actorUserId"
        ) VALUES ('migration-decision-old-client', $1, 'migration-case', 'migration-op-old',
                  'ACKNOWLEDGE', 'old client', 'manager')
        RETURNING "caseRevision"
      `, organizationId)
    })
    expect(oldClientInsert).toEqual([{ caseRevision: 4 }])

    // The cutover binary supplies the same next revision explicitly.
    const newClientInsert = await observer.$transaction(async (tx) => {
      await useMigrationSchema(tx)
      return tx.$queryRawUnsafe<Array<{ caseRevision: number }>>(`
        INSERT INTO "${schema}"."workforce_exception_decisions" (
          "id", "organizationId", "caseId", "operationId", "decisionCode", "reason",
          "actorUserId", "caseRevision"
        ) VALUES ('migration-decision-new-client', $1, 'migration-case', 'migration-op-new',
                  'ACKNOWLEDGE', 'new client', 'manager', 5)
        RETURNING "caseRevision"
      `, organizationId)
    })
    expect(newClientInsert).toEqual([{ caseRevision: 5 }])

    await expect(observer.$transaction(async (tx) => {
      await useMigrationSchema(tx)
      await tx.$executeRawUnsafe(`
        INSERT INTO "${schema}"."workforce_exception_decisions" (
          "id", "organizationId", "caseId", "operationId", "decisionCode", "reason",
          "actorUserId", "caseRevision"
        ) VALUES ('migration-decision-stale', $1, 'migration-case', 'migration-op-stale',
                  'ACKNOWLEDGE', 'stale', 'manager', 3)
      `, organizationId)
    })).rejects.toBeDefined()

    await expect(observer.$transaction(async (tx) => {
      await useMigrationSchema(tx)
      await tx.$executeRawUnsafe(`
        INSERT INTO "${schema}"."workforce_exception_employee_responses" (
          "id", "organizationId", "caseId", "agentId", "workdayId", "segmentId",
          "correctionRequestId", "responseCode", "clientResponseId", "actorUserId",
          "observedCaseRevision"
        ) VALUES ('migration-response-exact', $1, 'migration-case', 'migration-agent',
                  'migration-workday', 'migration-segment', NULL, 'ACKNOWLEDGED',
                  'migration-response-exact', 'migration-user', 5)
      `, organizationId)
    })).resolves.toBeUndefined()
    await expect(observer.$transaction(async (tx) => {
      await useMigrationSchema(tx)
      await tx.$executeRawUnsafe(`
        INSERT INTO "${schema}"."mtm_hrm_requests" (
          "id", "organizationId", "agentId", "type", "correctionWorkdayId",
          "exceptionCaseId", "exceptionCaseRevision"
        ) VALUES
          ('migration-request-other-case', $1, 'migration-agent', 'TIME_CORRECTION',
           'migration-workday', 'migration-other-case', 0),
          ('migration-request-unlinked', $1, 'migration-agent', 'TIME_CORRECTION',
           'migration-workday', NULL, NULL)
      `, organizationId)
    })).resolves.toBeUndefined()
    for (const [responseId, requestId] of [
      ["migration-response-other-case", "migration-request-other-case"],
      ["migration-response-unlinked", "migration-request-unlinked"],
    ] as const) {
      await expect(observer.$transaction(async (tx) => {
        await useMigrationSchema(tx)
        await tx.$executeRawUnsafe(`
          INSERT INTO "${schema}"."workforce_exception_employee_responses" (
            "id", "organizationId", "caseId", "agentId", "workdayId", "segmentId",
            "correctionRequestId", "responseCode", "clientResponseId", "actorUserId",
            "observedCaseRevision"
          ) VALUES ($1, $2, 'migration-case', 'migration-agent', 'migration-workday',
                    'migration-segment', $3, 'CORRECTION_REQUESTED', $1, 'migration-user', 5)
        `, responseId, organizationId, requestId)
      })).rejects.toBeDefined()
    }
    await expect(observer.$transaction(async (tx) => {
      await useMigrationSchema(tx)
      await tx.$executeRawUnsafe(`
        INSERT INTO "${schema}"."workforce_exception_employee_responses" (
          "id", "organizationId", "caseId", "agentId", "workdayId", "segmentId",
          "correctionRequestId", "responseCode", "clientResponseId", "actorUserId",
          "observedCaseRevision"
        ) VALUES ('migration-response-stale', $1, 'migration-case', 'migration-agent',
                  'migration-workday', 'migration-segment', NULL, 'ACKNOWLEDGED',
                  'migration-response-stale', 'migration-user', 4)
      `, organizationId)
    })).rejects.toBeDefined()
    const oldResponseInsert = await observer.$transaction(async (tx) => {
      await useMigrationSchema(tx)
      return tx.$queryRawUnsafe<Array<{ observedCaseRevision: number }>>(`
        INSERT INTO "${schema}"."workforce_exception_employee_responses" (
          "id", "organizationId", "caseId", "agentId", "workdayId", "segmentId",
          "correctionRequestId", "responseCode", "clientResponseId", "actorUserId",
          "observedCaseRevision"
        ) VALUES ('migration-response-legacy', $1, 'migration-case', 'migration-agent',
                  'migration-workday', 'migration-segment', NULL, 'ACKNOWLEDGED',
                  'migration-response-legacy', 'migration-user', NULL)
        RETURNING "observedCaseRevision"
      `, organizationId)
    })
    expect(oldResponseInsert).toEqual([{ observedCaseRevision: 5 }])

    await expect(observer.$transaction(async (tx) => {
      await useMigrationSchema(tx)
      await tx.$executeRawUnsafe(`
        INSERT INTO "${schema}"."mtm_hrm_requests" (
          "id", "organizationId", "agentId", "type", "correctionWorkdayId",
          "exceptionCaseId", "exceptionCaseRevision"
        ) VALUES ('migration-request-exact', $1, 'migration-agent', 'TIME_CORRECTION',
                  'migration-workday', 'migration-case', 5)
      `, organizationId)
    })).resolves.toBeUndefined()
    await expect(observer.$transaction(async (tx) => {
      await useMigrationSchema(tx)
      await tx.$executeRawUnsafe(`
        INSERT INTO "${schema}"."workforce_exception_employee_responses" (
          "id", "organizationId", "caseId", "agentId", "workdayId", "segmentId",
          "correctionRequestId", "responseCode", "clientResponseId", "actorUserId",
          "observedCaseRevision"
        ) VALUES ('migration-response-correction-exact', $1, 'migration-case',
                  'migration-agent', 'migration-workday', 'migration-segment',
                  'migration-request-exact', 'CORRECTION_REQUESTED',
                  'migration-response-correction-exact', 'migration-user', 5)
      `, organizationId)
    })).resolves.toBeUndefined()
    const updatedRequest = await observer.$transaction(async (tx) => {
      await useMigrationSchema(tx)
      return tx.$queryRawUnsafe<Array<{ exceptionCaseRevision: number }>>(`
        UPDATE "${schema}"."mtm_hrm_requests"
           SET "status" = 'APPROVED'
         WHERE "id" = 'migration-request-exact'
        RETURNING "exceptionCaseRevision"
      `)
    })
    expect(updatedRequest).toEqual([{ exceptionCaseRevision: 5 }])
    await expect(observer.$transaction(async (tx) => {
      await useMigrationSchema(tx)
      await tx.$executeRawUnsafe(`
        INSERT INTO "${schema}"."mtm_hrm_requests" (
          "id", "organizationId", "agentId", "type", "correctionWorkdayId",
          "exceptionCaseId", "exceptionCaseRevision"
        ) VALUES ('migration-request-stale', $1, 'migration-agent', 'TIME_CORRECTION',
                  'migration-workday', 'migration-case', 4)
      `, organizationId)
    })).rejects.toBeDefined()
    const oldRequestInsert = await observer.$transaction(async (tx) => {
      await useMigrationSchema(tx)
      return tx.$queryRawUnsafe<Array<{ exceptionCaseRevision: number }>>(`
        INSERT INTO "${schema}"."mtm_hrm_requests" (
          "id", "organizationId", "agentId", "type", "correctionWorkdayId",
          "exceptionCaseId", "exceptionCaseRevision"
        ) VALUES ('migration-request-legacy', $1, 'migration-agent', 'TIME_CORRECTION',
                  'migration-workday', 'migration-case', NULL)
        RETURNING "exceptionCaseRevision"
      `, organizationId)
    })
    expect(oldRequestInsert).toEqual([{ exceptionCaseRevision: 5 }])
    const [unlinkedRequest] = await observer.$queryRawUnsafe<Array<{
      exceptionCaseRevision: number | null
    }>>(`
      SELECT "exceptionCaseRevision"
        FROM "${schema}"."mtm_hrm_requests"
       WHERE "id" = 'migration-request-unlinked'
    `)
    expect(unlinkedRequest).toEqual({ exceptionCaseRevision: null })

    // A stale signal can carry a client timestamp later than wall-clock now.
    // The next reset advances its compatibility timestamp past that signal,
    // so a draining old timestamp reader and the revision reader both classify
    // the signal as belonging to the earlier cycle.
    const [preResetRequest] = await observer.$transaction(async (tx) => {
      await useMigrationSchema(tx)
      return tx.$queryRawUnsafe<Array<{
        exceptionCaseRevision: number
        submittedAt: Date
      }>>(`
        INSERT INTO "${schema}"."mtm_hrm_requests" (
          "id", "organizationId", "agentId", "type", "correctionWorkdayId",
          "exceptionCaseId", "exceptionCaseRevision", "submittedAt"
        ) VALUES ('migration-request-before-reset', $1, 'migration-agent',
                  'TIME_CORRECTION', 'migration-workday', 'migration-case', 5,
                  clock_timestamp() + INTERVAL '4 minutes')
        RETURNING "exceptionCaseRevision", "submittedAt"
      `, organizationId)
    })
    const [resetDecision] = await observer.$transaction(async (tx) => {
      await useMigrationSchema(tx)
      return tx.$queryRawUnsafe<Array<{ caseRevision: number; createdAt: Date }>>(`
        INSERT INTO "${schema}"."workforce_exception_decisions" (
          "id", "organizationId", "caseId", "operationId", "decisionCode", "reason",
          "actorUserId", "caseRevision"
        ) VALUES ('migration-decision-reset', $1, 'migration-case', 'migration-op-reset',
                  'REQUEST_EMPLOYEE_RESPONSE', 'reset', 'manager', 6)
        RETURNING "caseRevision", "createdAt"
      `, organizationId)
    })
    expect(preResetRequest.exceptionCaseRevision).toBe(5)
    expect(resetDecision.caseRevision).toBe(6)
    expect(resetDecision.createdAt.getTime()).toBeGreaterThan(preResetRequest.submittedAt.getTime())
    await expect(observer.$transaction(async (tx) => {
      await useMigrationSchema(tx)
      await tx.$executeRawUnsafe(`
        UPDATE "${schema}"."mtm_hrm_requests"
           SET "exceptionCaseRevision" = 4
         WHERE "id" = 'migration-request-exact'
      `)
    })).rejects.toBeDefined()
  }, 20_000)

  it("allocates the next revision from a fresh post-lock snapshot", async () => {
    const caseId = `migration-concurrent-${randomUUID()}`
    const waiterStarted = deferred<void>()
    const allowWaiterInsert = deferred<void>()
    const waiterPid = deferred<number>()
    const waiter = linkedClient.$transaction(async (tx) => {
      await useMigrationSchema(tx)
      const [start] = await tx.$queryRawUnsafe<Array<{
        pid: number
        transactionStartedAt: Date
      }>>(`
        SELECT pg_backend_pid()::int AS pid,
               transaction_timestamp() AS "transactionStartedAt"
      `)
      waiterPid.resolve(start.pid)
      waiterStarted.resolve()
      await allowWaiterInsert.promise
      const [inserted] = await tx.$queryRawUnsafe<Array<{
        caseRevision: number
        createdAt: Date
      }>>(`
        INSERT INTO "${schema}"."workforce_exception_decisions" (
          "id", "organizationId", "caseId", "operationId", "decisionCode", "reason", "actorUserId"
        ) VALUES ($1, $2, $3, $4, 'ACKNOWLEDGE', 'waiter', 'manager')
        RETURNING "caseRevision", "createdAt"
      `, `waiter-${randomUUID()}`, organizationId, caseId, `waiter-op-${randomUUID()}`)
      return { ...inserted, transactionStartedAt: start.transactionStartedAt }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10_000 })

    await waiterStarted.promise
    const winnerInserted = deferred<void>()
    const releaseWinner = deferred<void>()
    const winner = terminalClient.$transaction(async (tx) => {
      await useMigrationSchema(tx)
      const [inserted] = await tx.$queryRawUnsafe<Array<{
        caseRevision: number
        createdAt: Date
      }>>(`
        INSERT INTO "${schema}"."workforce_exception_decisions" (
          "id", "organizationId", "caseId", "operationId", "decisionCode", "reason", "actorUserId"
        ) VALUES ($1, $2, $3, $4, 'ACKNOWLEDGE', 'winner', 'manager')
        RETURNING "caseRevision", "createdAt"
      `, `winner-${randomUUID()}`, organizationId, caseId, `winner-op-${randomUUID()}`)
      winnerInserted.resolve()
      await releaseWinner.promise
      return inserted
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10_000 })

    await winnerInserted.promise
    allowWaiterInsert.resolve()
    try {
      await waitForAdvisoryLockWait(await waiterPid.promise)
    } finally {
      releaseWinner.resolve()
    }
    const winnerResult = await winner
    const waiterResult = await waiter
    expect(winnerResult.caseRevision).toBe(1)
    expect(waiterResult.caseRevision).toBe(2)
    expect(waiterResult.transactionStartedAt.getTime()).toBeLessThan(winnerResult.createdAt.getTime())
    expect(waiterResult.createdAt.getTime()).toBeGreaterThan(winnerResult.createdAt.getTime())
  }, 15_000)

  it("validates response and request signals from a fresh post-lock snapshot", async () => {
    const caseId = `migration-signal-race-${randomUUID()}`
    await observer.$executeRawUnsafe(`
      INSERT INTO "${schema}"."workforce_exception_cases" (
        "id", "organizationId", "agentId", "workdayId", "segmentId"
      ) VALUES ($1, $2, 'migration-agent', 'migration-workday', 'migration-segment')
    `, caseId, organizationId)
    await observer.$transaction(async (tx) => {
      await useMigrationSchema(tx)
      await tx.$executeRawUnsafe(`
        INSERT INTO "${schema}"."workforce_exception_decisions" (
          "id", "organizationId", "caseId", "operationId", "decisionCode", "reason", "actorUserId"
        ) VALUES ($1, $2, $3, $4, 'REQUEST_EMPLOYEE_RESPONSE', 'initial', 'manager')
      `, `initial-${randomUUID()}`, organizationId, caseId, `initial-op-${randomUUID()}`)
    })

    async function holdNextDecision(revision: number): Promise<{
      inserted: Deferred<void>
      release: Deferred<void>
      transaction: Promise<void>
    }> {
      const inserted = deferred<void>()
      const release = deferred<void>()
      const transaction = terminalClient.$transaction(async (tx) => {
        await useMigrationSchema(tx)
        await tx.$executeRawUnsafe(`
          INSERT INTO "${schema}"."workforce_exception_decisions" (
            "id", "organizationId", "caseId", "operationId", "decisionCode", "reason",
            "actorUserId", "caseRevision"
          ) VALUES ($1, $2, $3, $4, 'REQUEST_EMPLOYEE_RESPONSE', 'race', 'manager', $5)
        `, `race-${randomUUID()}`, organizationId, caseId, `race-op-${randomUUID()}`, revision)
        inserted.resolve()
        await release.promise
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 10_000,
      })
      return { inserted, release, transaction }
    }

    const responseDecision = await holdNextDecision(2)
    await responseDecision.inserted.promise
    const responsePid = deferred<number>()
    const response = linkedClient.$transaction(async (tx) => {
      await useMigrationSchema(tx)
      const [backend] = await tx.$queryRawUnsafe<Array<{ pid: number }>>(
        "SELECT pg_backend_pid()::int AS pid",
      )
      responsePid.resolve(backend.pid)
      await tx.$executeRawUnsafe(`
        INSERT INTO "${schema}"."workforce_exception_employee_responses" (
          "id", "organizationId", "caseId", "agentId", "workdayId", "segmentId",
          "correctionRequestId", "responseCode", "clientResponseId", "actorUserId",
          "observedCaseRevision"
        ) VALUES ($1, $2, $3, 'migration-agent', 'migration-workday',
                  'migration-segment', NULL, 'ACKNOWLEDGED', $1, 'migration-user', 2)
      `, `race-response-${randomUUID()}`, organizationId, caseId)
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: 10_000,
    })
    try {
      await waitForAdvisoryLockWait(await responsePid.promise)
    } finally {
      responseDecision.release.resolve()
    }
    await responseDecision.transaction
    await expect(response).resolves.toBeUndefined()

    const requestDecision = await holdNextDecision(3)
    await requestDecision.inserted.promise
    const requestPid = deferred<number>()
    const request = linkedClient.$transaction(async (tx) => {
      await useMigrationSchema(tx)
      const [backend] = await tx.$queryRawUnsafe<Array<{ pid: number }>>(
        "SELECT pg_backend_pid()::int AS pid",
      )
      requestPid.resolve(backend.pid)
      await tx.$executeRawUnsafe(`
        INSERT INTO "${schema}"."mtm_hrm_requests" (
          "id", "organizationId", "agentId", "type", "correctionWorkdayId",
          "exceptionCaseId", "exceptionCaseRevision"
        ) VALUES ($1, $2, 'migration-agent', 'TIME_CORRECTION', 'migration-workday', $3, 3)
      `, `race-request-${randomUUID()}`, organizationId, caseId)
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: 10_000,
    })
    try {
      await waitForAdvisoryLockWait(await requestPid.promise)
    } finally {
      requestDecision.release.resolve()
    }
    await requestDecision.transaction
    await expect(request).resolves.toBeUndefined()
  }, 25_000)

  it("makes a linked writer wait for terminal resolution and reject from the post-lock lifecycle", async () => {
    const caseId = `terminal-first-${randomUUID()}`
    await observer.$executeRawUnsafe(`
      INSERT INTO "${schema}"."case_decisions" ("organization_id", "case_id")
      VALUES ($1, $2)
    `, organizationId, caseId)
    await observer.$executeRawUnsafe(`
      INSERT INTO "${schema}"."linked_mutations" ("organization_id", "case_id")
      VALUES ($1, $2)
    `, organizationId, caseId)

    const terminalHasLock = deferred<void>()
    const releaseTerminal = deferred<void>()
    const terminal = terminalClient.$transaction(async (tx) => {
      await configureBoundedTransaction(tx)
      await lockWorkforceExceptionDecisionStream(tx, { organizationId, caseId })
      await tx.$executeRawUnsafe(`
        UPDATE "${schema}"."case_decisions"
           SET "decisions" = '["ACKNOWLEDGE", "RESOLVE_NO_CHANGE"]'::jsonb
         WHERE "organization_id" = $1 AND "case_id" = $2
      `, organizationId, caseId)
      terminalHasLock.resolve()
      await releaseTerminal.promise
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 10_000,
    })

    await terminalHasLock.promise
    const linkedPid = deferred<number>()
    const linkedOutcome = linkedClient.$transaction(async (tx) => {
      await configureBoundedTransaction(tx)
      const [backend] = await tx.$queryRawUnsafe<Array<{ pid: number }>>(
        "SELECT pg_backend_pid()::int AS pid",
      )
      linkedPid.resolve(backend.pid)
      await lockWorkforceExceptionLinkedMutation({
        db: linkedMutationDb(tx),
        organizationId,
        caseId,
      })
      await tx.$executeRawUnsafe(`
        UPDATE "${schema}"."linked_mutations"
           SET "mutation_count" = "mutation_count" + 1
         WHERE "organization_id" = $1 AND "case_id" = $2
      `, organizationId, caseId)
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 10_000,
    }).then(
      () => ({ status: "fulfilled" as const }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    )

    try {
      await waitForAdvisoryLockWait(await linkedPid.promise)
    } finally {
      releaseTerminal.resolve()
    }
    await terminal

    const outcome = await linkedOutcome
    expect(outcome).toMatchObject({
      status: "rejected",
      error: { code: "WORKFORCE_EXCEPTION_LINKED_MUTATION_RESOLVED" },
    })
    await expect(readState(caseId)).resolves.toEqual({
      decisions: ["ACKNOWLEDGE", "RESOLVE_NO_CHANGE"],
      linked_mutation_count: 0,
    })
  }, 15_000)

  it("makes terminal resolution wait for and observe a committed linked mutation", async () => {
    const caseId = `linked-first-${randomUUID()}`
    await observer.$executeRawUnsafe(`
      INSERT INTO "${schema}"."case_decisions" (
        "organization_id", "case_id", "decisions"
      ) VALUES ($1, $2, '["ACKNOWLEDGE"]'::jsonb)
    `, organizationId, caseId)
    await observer.$executeRawUnsafe(`
      INSERT INTO "${schema}"."linked_mutations" ("organization_id", "case_id")
      VALUES ($1, $2)
    `, organizationId, caseId)

    const linkedHasLock = deferred<void>()
    const releaseLinked = deferred<void>()
    const linked = linkedClient.$transaction(async (tx) => {
      await configureBoundedTransaction(tx)
      await lockWorkforceExceptionLinkedMutation({
        db: linkedMutationDb(tx),
        organizationId,
        caseId,
      })
      await tx.$executeRawUnsafe(`
        UPDATE "${schema}"."linked_mutations"
           SET "mutation_count" = "mutation_count" + 1
         WHERE "organization_id" = $1 AND "case_id" = $2
      `, organizationId, caseId)
      linkedHasLock.resolve()
      await releaseLinked.promise
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 10_000,
    })

    await linkedHasLock.promise
    const terminalPid = deferred<number>()
    const terminal = terminalClient.$transaction(async (tx) => {
      await configureBoundedTransaction(tx)
      const [backend] = await tx.$queryRawUnsafe<Array<{ pid: number }>>(
        "SELECT pg_backend_pid()::int AS pid",
      )
      terminalPid.resolve(backend.pid)
      const [beforeLock] = await tx.$queryRawUnsafe<Array<{ mutation_count: number }>>(`
        SELECT "mutation_count"
          FROM "${schema}"."linked_mutations"
         WHERE "organization_id" = $1 AND "case_id" = $2
      `, organizationId, caseId)
      await lockWorkforceExceptionDecisionStream(tx, { organizationId, caseId })
      const [afterLock] = await tx.$queryRawUnsafe<Array<{ mutation_count: number }>>(`
        SELECT "mutation_count"
          FROM "${schema}"."linked_mutations"
         WHERE "organization_id" = $1 AND "case_id" = $2
      `, organizationId, caseId)
      await tx.$executeRawUnsafe(`
        UPDATE "${schema}"."case_decisions"
           SET "decisions" = "decisions" || '["RESOLVE_NO_CHANGE"]'::jsonb
         WHERE "organization_id" = $1 AND "case_id" = $2
      `, organizationId, caseId)
      return { beforeLock: beforeLock.mutation_count, afterLock: afterLock.mutation_count }
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 10_000,
    })

    try {
      await waitForAdvisoryLockWait(await terminalPid.promise)
    } finally {
      releaseLinked.resolve()
    }
    await linked

    await expect(terminal).resolves.toEqual({ beforeLock: 0, afterLock: 1 })
    await expect(readState(caseId)).resolves.toEqual({
      decisions: ["ACKNOWLEDGE", "RESOLVE_NO_CHANGE"],
      linked_mutation_count: 1,
    })
  }, 15_000)

  it("records causal revision order even when transaction timestamps are inverted", async () => {
    const caseId = `revision-clock-inversion-${randomUUID()}`
    const agentId = `revision-agent-${randomUUID()}`
    await observer.$executeRawUnsafe(`
      INSERT INTO "${schema}"."case_decisions" ("organization_id", "case_id")
      VALUES ($1, $2)
    `, organizationId, caseId)

    // Start the employee transaction first so PostgreSQL now() is older, but
    // deliberately let the later reset transaction acquire the case lock
    // first. The employee write is causally after the reset despite its older
    // transaction timestamp.
    const linkedStarted = deferred<void>()
    const allowLinkedLock = deferred<void>()
    const linkedPid = deferred<number>()
    const linked = linkedClient.$transaction(async (tx) => {
      await configureBoundedTransaction(tx)
      await tx.$queryRawUnsafe("SELECT now()")
      const [backend] = await tx.$queryRawUnsafe<Array<{ pid: number }>>(
        "SELECT pg_backend_pid()::int AS pid",
      )
      linkedPid.resolve(backend.pid)
      linkedStarted.resolve()
      await allowLinkedLock.promise
      return appendAuthorizedWorkforceExceptionEmployeeResponse({
        db: employeeResponseDb(tx),
        draft: {
          organizationId,
          caseId,
          agentId,
          workdayId: "workday-revision",
          segmentId: null,
          correctionRequestId: null,
          responseCode: "ACKNOWLEDGED",
          clientResponseId: `response-${randomUUID()}`,
          actorUserId: "employee-user",
        },
        authorize: async () => true,
      })
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 10_000,
    })

    await linkedStarted.promise
    const resetHasLock = deferred<void>()
    const releaseReset = deferred<void>()
    const reset = terminalClient.$transaction(async (tx) => {
      await configureBoundedTransaction(tx)
      await lockWorkforceExceptionDecisionStream(tx, { organizationId, caseId })
      await tx.$executeRawUnsafe(`
        UPDATE "${schema}"."case_decisions"
           SET "decisions" = '["REQUEST_EMPLOYEE_RESPONSE"]'::jsonb,
               "last_decision_created_at" = now()
         WHERE "organization_id" = $1 AND "case_id" = $2
      `, organizationId, caseId)
      resetHasLock.resolve()
      await releaseReset.promise
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 10_000,
    })

    await resetHasLock.promise
    allowLinkedLock.resolve()
    try {
      await waitForAdvisoryLockWait(await linkedPid.promise)
    } finally {
      releaseReset.resolve()
    }
    await reset
    await expect(linked).resolves.toMatchObject({ idempotent: false })

    const [stored] = await observer.$queryRawUnsafe<Array<{
      observed_case_revision: number
      response_created_at: Date
      reset_created_at: Date
    }>>(`
      SELECT response."observed_case_revision",
             response."created_at" AS "response_created_at",
             decisions."last_decision_created_at" AS "reset_created_at"
        FROM "${schema}"."employee_responses" response
        JOIN "${schema}"."case_decisions" decisions
          ON decisions."organization_id" = response."organization_id"
         AND decisions."case_id" = response."case_id"
       WHERE response."organization_id" = $1 AND response."case_id" = $2
    `, organizationId, caseId)
    expect(stored.observed_case_revision).toBe(1)
    expect(stored.response_created_at.getTime()).toBeLessThan(stored.reset_created_at.getTime())
  }, 15_000)

  it("serializes cross-domain writers in the global workday then case order", async () => {
    const agentId = `agent-${randomUUID()}`
    const caseId = `ordered-locks-${randomUUID()}`
    const firstHasBothLocks = deferred<void>()
    const releaseFirst = deferred<void>()
    const first = terminalClient.$transaction(async (tx) => {
      await configureBoundedTransaction(tx)
      await lockMtmWorkdayTransitions(tx, { organizationId, agentId })
      await lockWorkforceExceptionDecisionStream(tx, { organizationId, caseId })
      firstHasBothLocks.resolve()
      await releaseFirst.promise
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 10_000,
    })

    await firstHasBothLocks.promise
    const secondPid = deferred<number>()
    const second = linkedClient.$transaction(async (tx) => {
      await configureBoundedTransaction(tx)
      const [backend] = await tx.$queryRawUnsafe<Array<{ pid: number }>>(
        "SELECT pg_backend_pid()::int AS pid",
      )
      secondPid.resolve(backend.pid)
      await lockMtmWorkdayTransitions(tx, { organizationId, agentId })
      await lockWorkforceExceptionDecisionStream(tx, { organizationId, caseId })
      return "completed"
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 10_000,
    })

    try {
      await waitForAdvisoryLockWait(await secondPid.promise)
    } finally {
      releaseFirst.resolve()
    }
    await first
    await expect(second).resolves.toBe("completed")
  }, 15_000)

  it("serializes one employee response id across different exception cases", async () => {
    const caseA = `response-case-a-${randomUUID()}`
    const caseB = `response-case-b-${randomUUID()}`
    const agentId = `response-agent-${randomUUID()}`
    const clientResponseId = `response-client-${randomUUID()}`
    await observer.$executeRawUnsafe(`
      INSERT INTO "${schema}"."case_decisions" ("organization_id", "case_id")
      VALUES ($1, $2), ($1, $3)
    `, organizationId, caseA, caseB)

    let createCount = 0
    const winnerInserted = deferred<void>()
    const releaseWinner = deferred<void>()
    const winner = terminalClient.$transaction(async (tx) => {
      await configureBoundedTransaction(tx)
      return appendAuthorizedWorkforceExceptionEmployeeResponse({
        db: employeeResponseDb(tx, {
          onCreate: () => { createCount += 1 },
          onAudit: async () => {
            winnerInserted.resolve()
            await releaseWinner.promise
          },
        }),
        draft: {
          organizationId,
          caseId: caseA,
          agentId,
          workdayId: "workday-a",
          segmentId: null,
          correctionRequestId: null,
          responseCode: "ACKNOWLEDGED",
          clientResponseId,
          actorUserId: "employee-user",
        },
        authorize: async () => true,
      })
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 10_000,
    })

    await winnerInserted.promise
    const waiterPid = deferred<number>()
    const waiter = linkedClient.$transaction(async (tx) => {
      await configureBoundedTransaction(tx)
      const [backend] = await tx.$queryRawUnsafe<Array<{ pid: number }>>(
        "SELECT pg_backend_pid()::int AS pid",
      )
      waiterPid.resolve(backend.pid)
      return appendAuthorizedWorkforceExceptionEmployeeResponse({
        db: employeeResponseDb(tx, { onCreate: () => { createCount += 1 } }),
        draft: {
          organizationId,
          caseId: caseB,
          agentId,
          workdayId: "workday-b",
          segmentId: null,
          correctionRequestId: null,
          responseCode: "ACKNOWLEDGED",
          clientResponseId,
          actorUserId: "employee-user",
        },
        authorize: async () => true,
      })
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 10_000,
    }).then(
      (value) => ({ status: "fulfilled" as const, value }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    )

    try {
      await waitForAdvisoryLockWait(await waiterPid.promise)
    } finally {
      releaseWinner.resolve()
    }
    await expect(winner).resolves.toMatchObject({ idempotent: false })
    await expect(waiter).resolves.toMatchObject({
      status: "rejected",
      error: { code: "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_WRITE_CONFLICT" },
    })
    expect(createCount).toBe(1)
    const stored = await observer.$queryRawUnsafe<Array<{ case_id: string }>>(`
      SELECT "case_id" FROM "${schema}"."employee_responses"
       WHERE "organization_id" = $1 AND "agent_id" = $2 AND "client_response_id" = $3
    `, organizationId, agentId, clientResponseId)
    expect(stored).toEqual([{ case_id: caseA }])
  }, 15_000)

  it("serializes one HR request client key before selecting a linked case", async () => {
    const caseA = `request-case-a-${randomUUID()}`
    const caseB = `request-case-b-${randomUUID()}`
    const agentId = `request-agent-${randomUUID()}`
    const clientRequestId = `request-client-${randomUUID()}`
    const winnerInserted = deferred<void>()
    const releaseWinner = deferred<void>()
    const winner = terminalClient.$transaction(async (tx) => {
      await configureBoundedTransaction(tx)
      await lockWorkforceHrmRequestClientKey(tx, { organizationId, agentId, clientRequestId })
      await lockWorkforceExceptionDecisionStream(tx, { organizationId, caseId: caseA })
      await tx.$executeRawUnsafe(`
        INSERT INTO "${schema}"."linked_requests" (
          "organization_id", "agent_id", "case_id", "client_request_id", "status"
        ) VALUES ($1, $2, $3, $4, 'PENDING')
      `, organizationId, agentId, caseA, clientRequestId)
      winnerInserted.resolve()
      await releaseWinner.promise
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 10_000,
    })

    await winnerInserted.promise
    const waiterPid = deferred<number>()
    const waiter = linkedClient.$transaction(async (tx) => {
      await configureBoundedTransaction(tx)
      const [backend] = await tx.$queryRawUnsafe<Array<{ pid: number }>>(
        "SELECT pg_backend_pid()::int AS pid",
      )
      waiterPid.resolve(backend.pid)
      await lockWorkforceHrmRequestClientKey(tx, { organizationId, agentId, clientRequestId })
      const rows = await tx.$queryRawUnsafe<Array<{ case_id: string }>>(`
        SELECT "case_id" FROM "${schema}"."linked_requests"
         WHERE "organization_id" = $1 AND "agent_id" = $2 AND "client_request_id" = $3
      `, organizationId, agentId, clientRequestId)
      if (rows[0]) return { replayCaseId: rows[0].case_id, inserted: false }
      await lockWorkforceExceptionDecisionStream(tx, { organizationId, caseId: caseB })
      throw new Error("global request lock did not expose the committed winner")
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 10_000,
    })

    try {
      await waitForAdvisoryLockWait(await waiterPid.promise)
    } finally {
      releaseWinner.resolve()
    }
    await winner
    await expect(waiter).resolves.toEqual({ replayCaseId: caseA, inserted: false })
  }, 15_000)

  it("serializes one decision operation id across different case streams", async () => {
    const caseA = `decision-case-a-${randomUUID()}`
    const caseB = `decision-case-b-${randomUUID()}`
    const operationId = `decision-operation-${randomUUID()}`
    const winnerInserted = deferred<void>()
    const releaseWinner = deferred<void>()
    const winner = terminalClient.$transaction(async (tx) => {
      await configureBoundedTransaction(tx)
      await lockWorkforceExceptionDecisionStream(tx, { organizationId, caseId: caseA })
      await lockWorkforceExceptionDecisionOperation(tx, { organizationId, operationId })
      await tx.$executeRawUnsafe(`
        INSERT INTO "${schema}"."decision_operations" (
          "organization_id", "case_id", "operation_id"
        ) VALUES ($1, $2, $3)
      `, organizationId, caseA, operationId)
      winnerInserted.resolve()
      await releaseWinner.promise
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 10_000,
    })

    await winnerInserted.promise
    const waiterPid = deferred<number>()
    const waiter = linkedClient.$transaction(async (tx) => {
      await configureBoundedTransaction(tx)
      await lockWorkforceExceptionDecisionStream(tx, { organizationId, caseId: caseB })
      const [backend] = await tx.$queryRawUnsafe<Array<{ pid: number }>>(
        "SELECT pg_backend_pid()::int AS pid",
      )
      waiterPid.resolve(backend.pid)
      await lockWorkforceExceptionDecisionOperation(tx, { organizationId, operationId })
      const rows = await tx.$queryRawUnsafe<Array<{ case_id: string }>>(`
        SELECT "case_id" FROM "${schema}"."decision_operations"
         WHERE "organization_id" = $1 AND "operation_id" = $2
      `, organizationId, operationId)
      if (rows[0]) return { replayCaseId: rows[0].case_id, inserted: false }
      throw new Error("global operation lock did not expose the committed winner")
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 10_000,
    })

    try {
      await waitForAdvisoryLockWait(await waiterPid.promise)
    } finally {
      releaseWinner.resolve()
    }
    await winner
    await expect(waiter).resolves.toEqual({ replayCaseId: caseA, inserted: false })
  }, 15_000)

  it("observes exact submit and cancellation replays after waiting for the case lock", async () => {
    const caseId = `replay-${randomUUID()}`
    const clientRequestId = `client-${randomUUID()}`

    const submitHasLock = deferred<void>()
    const releaseSubmit = deferred<void>()
    const submitWinner = terminalClient.$transaction(async (tx) => {
      await configureBoundedTransaction(tx)
      await lockWorkforceExceptionDecisionStream(tx, { organizationId, caseId })
      await tx.$executeRawUnsafe(`
        INSERT INTO "${schema}"."linked_requests" (
          "organization_id", "case_id", "client_request_id", "status"
        ) VALUES ($1, $2, $3, 'PENDING')
      `, organizationId, caseId, clientRequestId)
      submitHasLock.resolve()
      await releaseSubmit.promise
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 10_000,
    })

    await submitHasLock.promise
    const submitWaiterPid = deferred<number>()
    const submitReplay = linkedClient.$transaction(async (tx) => {
      await configureBoundedTransaction(tx)
      const before = await tx.$queryRawUnsafe<Array<{ status: string }>>(`
        SELECT "status" FROM "${schema}"."linked_requests"
         WHERE "organization_id" = $1 AND "client_request_id" = $2
      `, organizationId, clientRequestId)
      const [backend] = await tx.$queryRawUnsafe<Array<{ pid: number }>>(
        "SELECT pg_backend_pid()::int AS pid",
      )
      submitWaiterPid.resolve(backend.pid)
      await lockWorkforceExceptionDecisionStream(tx, { organizationId, caseId })
      const after = await tx.$queryRawUnsafe<Array<{ status: string }>>(`
        SELECT "status" FROM "${schema}"."linked_requests"
         WHERE "organization_id" = $1 AND "client_request_id" = $2
      `, organizationId, clientRequestId)
      return { before: before[0]?.status ?? null, after: after[0]?.status ?? null }
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 10_000,
    })

    try {
      await waitForAdvisoryLockWait(await submitWaiterPid.promise)
    } finally {
      releaseSubmit.resolve()
    }
    await submitWinner
    await expect(submitReplay).resolves.toEqual({ before: null, after: "PENDING" })

    const cancelHasLock = deferred<void>()
    const releaseCancel = deferred<void>()
    const cancelWinner = terminalClient.$transaction(async (tx) => {
      await configureBoundedTransaction(tx)
      await lockWorkforceExceptionDecisionStream(tx, { organizationId, caseId })
      await tx.$executeRawUnsafe(`
        UPDATE "${schema}"."linked_requests" SET "status" = 'CANCELLED'
         WHERE "organization_id" = $1 AND "client_request_id" = $2
      `, organizationId, clientRequestId)
      cancelHasLock.resolve()
      await releaseCancel.promise
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 10_000,
    })

    await cancelHasLock.promise
    const cancelWaiterPid = deferred<number>()
    const cancelReplay = linkedClient.$transaction(async (tx) => {
      await configureBoundedTransaction(tx)
      const before = await tx.$queryRawUnsafe<Array<{ status: string }>>(`
        SELECT "status" FROM "${schema}"."linked_requests"
         WHERE "organization_id" = $1 AND "client_request_id" = $2
      `, organizationId, clientRequestId)
      const [backend] = await tx.$queryRawUnsafe<Array<{ pid: number }>>(
        "SELECT pg_backend_pid()::int AS pid",
      )
      cancelWaiterPid.resolve(backend.pid)
      await lockWorkforceExceptionDecisionStream(tx, { organizationId, caseId })
      const after = await tx.$queryRawUnsafe<Array<{ status: string }>>(`
        SELECT "status" FROM "${schema}"."linked_requests"
         WHERE "organization_id" = $1 AND "client_request_id" = $2
      `, organizationId, clientRequestId)
      return { before: before[0]?.status ?? null, after: after[0]?.status ?? null }
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 10_000,
    })

    try {
      await waitForAdvisoryLockWait(await cancelWaiterPid.promise)
    } finally {
      releaseCancel.resolve()
    }
    await cancelWinner
    await expect(cancelReplay).resolves.toEqual({ before: "PENDING", after: "CANCELLED" })
  }, 20_000)
})
