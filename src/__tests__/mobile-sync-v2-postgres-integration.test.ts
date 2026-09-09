// Optional real-Postgres proof for the route trigger fragment.
// Run only against an isolated scratch database:
// MOBILE_SYNC_V2_TEST_DATABASE_URL=postgresql://... \
//   npx vitest run src/__tests__/mobile-sync-v2-postgres-integration.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const url = process.env.MOBILE_SYNC_V2_TEST_DATABASE_URL
const schema = "mtm_mobile_sync_v2_integration"
const migration = readFileSync(join(
  process.cwd(),
  "prisma/migrations/20260828120000_mtm_mobile_sync_v2_foundation/migration.sql",
), "utf8")

function splitPostgresStatements(sql: string): string[] {
  const statements: string[] = []
  let statementStart = 0
  let index = 0
  let dollarQuote: string | null = null

  while (index < sql.length) {
    if (dollarQuote) {
      if (sql.startsWith(dollarQuote, index)) {
        index += dollarQuote.length
        dollarQuote = null
      } else {
        index += 1
      }
      continue
    }

    if (sql[index] === "$") {
      const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/u.exec(sql.slice(index))?.[0]
      if (tag) {
        dollarQuote = tag
        index += tag.length
        continue
      }
    }

    if (sql[index] === ";") {
      const statement = sql.slice(statementStart, index + 1).trim()
      if (statement) statements.push(statement)
      statementStart = index + 1
    }
    index += 1
  }
  const trailing = sql.slice(statementStart).trim()
  if (trailing) statements.push(trailing)
  return statements
}

function triggerSqlFromMigration(): string[] {
  const start = migration.indexOf("-- Atomically advance a stream revision")
  const finalTrigger = "FOR EACH ROW EXECUTE FUNCTION mtm_mobile_sync_route_assignment_change_trigger();"
  const end = migration.indexOf(finalTrigger)
  if (start < 0 || end < 0) throw new Error("Could not locate mobile sync v2 trigger SQL")
  // The migration installs pgcrypto. This isolated test only needs a unique
  // change ID, so avoid changing database-wide extensions in a scratch run.
  const fragment = migration.slice(start, end + finalTrigger.length)
    .replaceAll("gen_random_uuid()::text", "md5(random()::text || clock_timestamp()::text)")
  return splitPostgresStatements(fragment)
}

async function executeStatements(tx: any, sql: string): Promise<void> {
  for (const statement of splitPostgresStatements(sql)) {
    await tx.$executeRawUnsafe(statement)
  }
}

describe.skipIf(!url)("MTM mobile sync v2 trigger integration (real Postgres)", () => {
  let db: any

  async function inSchema<T>(work: (tx: any) => Promise<T>): Promise<T> {
    return db.$transaction(async (tx: any) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${schema}, public`)
      return work(tx)
    })
  }

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client")
    db = new PrismaClient({ datasourceUrl: url })
    // This exact named schema is test-owned. No production/shared database may
    // be supplied to this opt-in test URL.
    await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await db.$executeRawUnsafe(`CREATE SCHEMA ${schema}`)

    await inSchema(async (tx) => {
      await executeStatements(tx, `
        CREATE TABLE "organizations" ("id" TEXT PRIMARY KEY);
        CREATE TABLE "mtm_routes" (
          "id" TEXT PRIMARY KEY,
          "organizationId" TEXT NOT NULL,
          "agentId" TEXT NOT NULL,
          "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "status" TEXT NOT NULL DEFAULT 'DRAFT',
          "deletedAt" TIMESTAMP(3)
        );
        CREATE TABLE "mtm_route_points" (
          "id" TEXT PRIMARY KEY,
          "organizationId" TEXT NOT NULL,
          "routeId" TEXT NOT NULL,
          "deletedAt" TIMESTAMP(3)
        );
        CREATE TABLE "mtm_route_assignments" (
          "id" TEXT PRIMARY KEY,
          "organizationId" TEXT NOT NULL,
          "routeId" TEXT NOT NULL,
          "agentId" TEXT NOT NULL,
          "role" TEXT NOT NULL DEFAULT 'PARTICIPANT',
          "removedAt" TIMESTAMP(3),
          CONSTRAINT "mtm_route_assignments_route_agent_key" UNIQUE ("routeId", "agentId")
        );
        CREATE TABLE "mtm_mobile_sync_streams" (
          "organizationId" TEXT NOT NULL,
          "stream" TEXT NOT NULL,
          "revision" BIGINT NOT NULL DEFAULT 0,
          "retentionFloorRevision" BIGINT NOT NULL DEFAULT 0,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY ("organizationId", "stream")
        );
        CREATE TABLE "mtm_mobile_sync_agent_scopes" (
          "organizationId" TEXT NOT NULL,
          "stream" TEXT NOT NULL,
          "agentId" TEXT NOT NULL,
          "scopeRevision" BIGINT NOT NULL DEFAULT 0,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY ("organizationId", "stream", "agentId")
        );
        CREATE TABLE "mtm_mobile_sync_changes" (
          "id" TEXT PRIMARY KEY,
          "organizationId" TEXT NOT NULL,
          "stream" TEXT NOT NULL,
          "revision" BIGINT NOT NULL,
          "changeType" TEXT NOT NULL,
          "entityType" TEXT NOT NULL,
          "entityId" TEXT NOT NULL,
          "audienceAgentId" TEXT NOT NULL,
          "tombstoneReason" TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "expiresAt" TIMESTAMP(3) NOT NULL,
          UNIQUE ("organizationId", "stream", "revision")
        );
      `)
      for (const statement of triggerSqlFromMigration()) {
        await tx.$executeRawUnsafe(statement)
      }
    })
  })

  afterAll(async () => {
    if (!db) return
    await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {})
    await db.$disconnect()
  })

  it("repairs both route projections and fences a participant moved from R1 to R2", async () => {
    await inSchema(async (tx) => {
      await executeStatements(tx, `
        INSERT INTO "organizations" ("id") VALUES ('org-a');
        INSERT INTO "mtm_routes" ("id", "organizationId", "agentId") VALUES
          ('r1', 'org-a', 'agent-r1'),
          ('r2', 'org-a', 'agent-r2');
        INSERT INTO "mtm_route_assignments" ("id", "organizationId", "routeId", "agentId", "role")
          VALUES ('assignment-transfer', 'org-a', 'r1', 'agent-transfer', 'PARTICIPANT');
        TRUNCATE "mtm_mobile_sync_changes", "mtm_mobile_sync_agent_scopes", "mtm_mobile_sync_streams";
        UPDATE "mtm_route_assignments" SET "routeId" = 'r2' WHERE "id" = 'assignment-transfer';
      `)

      const changes = await tx.$queryRawUnsafe(`
        SELECT "changeType", "entityId", "audienceAgentId", "tombstoneReason"
        FROM "mtm_mobile_sync_changes"
        ORDER BY "revision"
      `) as Array<Record<string, string | null>>
      expect(changes).toEqual(expect.arrayContaining([
        expect.objectContaining({
          changeType: "TOMBSTONE",
          entityId: "r1",
          audienceAgentId: "agent-transfer",
          tombstoneReason: "SCOPE_REMOVED",
        }),
        expect.objectContaining({ changeType: "UPSERT", entityId: "r1", audienceAgentId: "agent-r1" }),
        expect.objectContaining({ changeType: "UPSERT", entityId: "r2", audienceAgentId: "agent-r2" }),
        expect.objectContaining({ changeType: "UPSERT", entityId: "r2", audienceAgentId: "agent-transfer" }),
      ]))
      const scope = await tx.$queryRawUnsafe(`
        SELECT "scopeRevision"::text AS revision
        FROM "mtm_mobile_sync_agent_scopes"
        WHERE "organizationId" = 'org-a' AND "stream" = 'routes' AND "agentId" = 'agent-transfer'
      `) as Array<{ revision: string }>
      expect(scope).toEqual([{ revision: "2" }])
    })
  })

  it("notifies old and new route audiences when a point is transferred", async () => {
    await inSchema(async (tx) => {
      await executeStatements(tx, `
        TRUNCATE "mtm_mobile_sync_changes", "mtm_mobile_sync_agent_scopes", "mtm_mobile_sync_streams";
        INSERT INTO "mtm_route_points" ("id", "organizationId", "routeId")
          VALUES ('point-transfer', 'org-a', 'r1');
        TRUNCATE "mtm_mobile_sync_changes", "mtm_mobile_sync_agent_scopes", "mtm_mobile_sync_streams";
        UPDATE "mtm_route_points" SET "routeId" = 'r2' WHERE "id" = 'point-transfer';
      `)

      const changes = await tx.$queryRawUnsafe(`
        SELECT "changeType", "entityId", "audienceAgentId"
        FROM "mtm_mobile_sync_changes"
        ORDER BY "revision"
      `) as Array<Record<string, string>>
      expect(changes).toEqual(expect.arrayContaining([
        expect.objectContaining({ changeType: "UPSERT", entityId: "r1", audienceAgentId: "agent-r1" }),
        expect.objectContaining({ changeType: "UPSERT", entityId: "r2", audienceAgentId: "agent-r2" }),
        expect.objectContaining({ changeType: "UPSERT", entityId: "r2", audienceAgentId: "agent-transfer" }),
      ]))
      expect(changes.some((change) => change.changeType === "TOMBSTONE")).toBe(false)
    })
  })

  it("fails closed if a maintenance write attempts to move a route across tenants", async () => {
    await inSchema(async (tx) => {
      await tx.$executeRawUnsafe(`INSERT INTO "organizations" ("id") VALUES ('org-b')`)
    })

    await expect(inSchema(async (tx) => {
      await tx.$executeRawUnsafe(`
        UPDATE "mtm_routes" SET "organizationId" = 'org-b' WHERE "id" = 'r1'
      `)
    })).rejects.toThrow(/mtm route cannot move across tenants/u)
  })

  it("rejects a new route child whose denormalised tenant does not match its parent", async () => {
    await expect(inSchema(async (tx) => {
      await tx.$executeRawUnsafe(`
        INSERT INTO "mtm_route_points" ("id", "organizationId", "routeId")
        VALUES ('cross-tenant-point', 'org-b', 'r1')
      `)
    })).rejects.toThrow(/mtm route child must belong to the same tenant/u)
  })
})
