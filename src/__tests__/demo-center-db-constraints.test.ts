/**
 * The demo tables' CHECK constraints against the code that writes them, on a
 * real Postgres.
 *
 * Why this exists: from 2026-09-20 to 2026-09-24 no demo link could be issued
 * on prod. Scenario grants were written with `moduleIds` = '{}', and the
 * database demanded 1..19 modules; the guided player's `journey.*` events were
 * outside the event-type allow-list. Every unit test was green, because every
 * one of them mocks Prisma — a mock accepts any row, a CHECK does not.
 *
 * Here every demo migration is replayed into a scratch database and the REAL
 * issuing path runs against it: the public form's `autoIssueDemoGrant`, which
 * calls `issueDemoGrant`, which writes the request claim, the grant, and its
 * ISSUED and SENT events. Only the e-mail provider and the sales-organisation
 * lookup (tables outside the demo migrations) are stubbed.
 *
 * Runs in CI's `static-checks` («Demo Center database constraints gate»),
 * where `DEMO_CENTER_TEST_DATABASE_URL` points at the job's Postgres service.
 * Without it the suite is skipped — and with `DEMO_CENTER_DB_GATE=required`
 * a missing URL fails instead of skipping, so the gate cannot go quietly green.
 */
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.DEMO_CENTER_TEST_DATABASE_URL
if (!adminUrl && process.env.DEMO_CENTER_DB_GATE === "required") {
  throw new Error("DEMO_CENTER_TEST_DATABASE_URL is required by the Demo Center database constraints gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.DEMO_CENTER_TEST_DATABASE_URL
  if (!admin) return null
  const name = `demo_center_ck_${process.pid}`
  const url = new URL(admin)
  url.pathname = `/${name}`
  // `@/lib/prisma` builds its client from DATABASE_URL when first imported,
  // which happens after the scratch database exists (dynamic import below).
  process.env.DATABASE_URL = url.toString()
  return { name, url: url.toString() }
})

vi.mock("@/lib/demo-center/email", () => ({
  sendDemoAccessEmail: vi.fn(async () => ({ success: true, messageId: "ci-message" })),
  sendDemoRequestNotification: vi.fn(async () => undefined),
}))
// The issuer lives in the sales organisation's users table, which is not a
// demo table; the grant only records the id.
vi.mock("@/lib/demo-center/sales-org", () => ({
  inDemoSalesOrganization: async () => ({ organizationId: "org-sales", value: [{ id: "user-manager", role: "manager" }] }),
}))

const ROOT = process.cwd()
const DEMO_TABLES = ['"demo_requests"', '"demo_grants"', '"demo_access_events"', '"demo_phone_verifications"']

function execute(url: string, args: string[], input?: string) {
  const result = spawnSync(path.join(ROOT, "node_modules/.bin/prisma"), ["db", "execute", "--url", url, ...args], {
    input,
    encoding: "utf8",
    env: process.env,
  })
  if (result.status !== 0) throw new Error(`prisma db execute ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`)
}

/** Every migration that touches a demo table, in the order `migrate deploy` applies them. */
function demoMigrations(): string[] {
  const dir = path.join(ROOT, "prisma/migrations")
  return readdirSync(dir)
    .sort()
    .map((name) => path.join(dir, name, "migration.sql"))
    .filter((file) => existsSync(file) && DEMO_TABLES.some((table) => readFileSync(file, "utf8").includes(table)))
}

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("demo tables on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass

  beforeAll(async () => {
    execute(adminUrl!, ["--stdin"], `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE); CREATE DATABASE "${scratch!.name}";`)
    const migrations = demoMigrations()
    // The first one creates the tables; a filter that found none would test nothing.
    expect(migrations.length).toBeGreaterThanOrEqual(7)
    for (const file of migrations) execute(scratch!.url, ["--file", file])
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
  }, 120_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) execute(adminUrl!, ["--stdin"], `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  async function storedRequest(email: string) {
    return bypass(() =>
      prisma.demoRequest.create({
        data: {
          name: "Nigar Əliyeva",
          company: "Xəzər Logistika MMC",
          email,
          emailNormalized: email,
          emailDomain: email.split("@")[1],
          locale: "az",
          consentAt: new Date(),
        },
        select: { id: true, name: true, company: true, email: true, emailNormalized: true, locale: true },
      }),
    )
  }

  it("issues the link the public form sends by itself: grant, ISSUED and SENT stored, request fulfilled", async () => {
    const { autoIssueDemoGrant } = await import("@/lib/demo-center/auto-issue")
    const request = await storedRequest("form@example.az")

    expect(await autoIssueDemoGrant({ request })).toBe("issued")

    const grants = await bypass(() => prisma.demoGrant.findMany({ where: { requestId: request.id } }))
    expect(grants).toHaveLength(1)
    expect(grants[0]).toMatchObject({ status: "SENT", moduleIds: [], liveCallEnabled: false })
    expect(grants[0].scenarioId).toBeTruthy()
    const events = await bypass(() => prisma.demoAccessEvent.findMany({ where: { grantId: grants[0].id }, orderBy: { occurredAt: "asc" } }))
    expect(events.map((event) => event.eventType)).toEqual(["ISSUED", "SENT"])
    const stored = await bypass(() => prisma.demoRequest.findUniqueOrThrow({ where: { id: request.id } }))
    expect(stored.status).toBe("FULFILLED")
  })

  it("issues a module playlist the admin picks, and a re-issue revokes the earlier link", async () => {
    const { issueDemoGrant } = await import("@/lib/demo-center/issue-grant")
    const request = await storedRequest("admin@example.az")
    const options = { moduleIds: ["crm", "sales"], linkValidDays: 7, sessionDurationMinutes: 120, inactivityMinutes: 30, locale: "az", liveCallEnabled: false }

    const first = await issueDemoGrant({ request, options, actorUserId: "user-admin" })
    const second = await issueDemoGrant({ request, options: { ...options, moduleIds: [], scenarioId: "prospect-to-closed-won" }, actorUserId: "user-admin" })
    expect(first.ok && second.ok).toBe(true)

    const grants = await bypass(() => prisma.demoGrant.findMany({ where: { requestId: request.id }, orderBy: { createdAt: "asc" } }))
    expect(grants.map((grant) => grant.status)).toEqual(["REVOKED", "SENT"])
  })

  it("still refuses a grant that is both a scenario and a playlist, or neither", async () => {
    const request = await storedRequest("invalid@example.az")
    const base = {
      requestId: request.id,
      tokenHint: "abcd",
      locale: "az",
      watermark: "ci",
      linkExpiresAt: new Date(Date.now() + 86_400_000),
      createdBy: "user-admin",
    }
    const token = (digit: string) => digit.repeat(64)
    await expect(bypass(() => prisma.demoGrant.create({ data: { ...base, tokenHash: token("a"), moduleIds: ["crm"], scenarioId: "prospect-to-closed-won", scenarioVersion: 1 } }))).rejects.toThrow()
    await expect(bypass(() => prisma.demoGrant.create({ data: { ...base, tokenHash: token("b"), moduleIds: [] } }))).rejects.toThrow()
  })

  it("stores every event type the demo code writes", async () => {
    const { REPORTED_JOURNEY_EVENTS } = await import("@/lib/demo-center/journey")
    const { writtenDemoEventTypes } = await import("./helpers/demo-event-types")
    const { autoIssueDemoGrant } = await import("@/lib/demo-center/auto-issue")
    const request = await storedRequest("events@example.az")
    await autoIssueDemoGrant({ request })
    const grant = await bypass(() => prisma.demoGrant.findFirstOrThrow({ where: { requestId: request.id } }))

    const types = new Set([...writtenDemoEventTypes(), ...REPORTED_JOURNEY_EVENTS])
    expect(types.has("journey.step_completed")).toBe(true)
    const refused: string[] = []
    for (const eventType of types) {
      await bypass(() => prisma.demoAccessEvent.create({ data: { grantId: grant.id, eventType } })).catch(() => refused.push(eventType))
    }
    expect(refused).toEqual([])
  })
})
