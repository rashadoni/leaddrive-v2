/**
 * Customer receiver runtime on a REAL PostgreSQL: the event-platform foundation
 * migration (effect_outbox state machine, attempt/reconciliation triggers,
 * FORCE RLS) plus this branch's runtime migration, exercised by an
 * unprivileged application role whose session TimeZone is deliberately NOT UTC.
 *
 * The suite creates and drops its own database next to the one named by
 * CUSTOMER_RECEIVER_RUNTIME_TEST_DATABASE_URL (an admin URL). Without that
 * variable it is skipped — a skipped run is "not verified", not "passed".
 *
 * No network: the receiving API is a recorded in-process stub.
 */
import { createHash, randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { PrismaClient, type Prisma } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { canonicalJson } from "@/lib/event-platform/canonical-json"
import { resetMasterKekCache } from "@/lib/crypto/tenant-pii-encryption"
import { BUILDER_FIELDS } from "@/lib/integrations/customer-receiver/constructor/catalog"
import { defaultBuilderProfile, type BuilderProfile } from "@/lib/integrations/customer-receiver/constructor/profile"
import type { BuilderSourceReader } from "@/lib/integrations/customer-receiver/constructor/source"
import type { RuntimeBinding, RuntimeSwitches } from "@/lib/integrations/customer-receiver/runtime/binding"
import { captureReceiverChange, type CaptureTransaction, type ReceiverEffectMetadata } from "@/lib/integrations/customer-receiver/runtime/capture"
import { placeReceiverIncidentHold, purgeExpiredReceiverPayloads } from "@/lib/integrations/customer-receiver/runtime/payload-store"
import { reconcileReceiverEffect } from "@/lib/integrations/customer-receiver/runtime/reconcile"
import { readRuntimeSecurityEvents } from "@/lib/integrations/customer-receiver/runtime/security-log"
import type { ReceiverDatabase } from "@/lib/integrations/customer-receiver/runtime/sql"
import { runReceiverDelivery, type ReceiverSendRequest } from "@/lib/integrations/customer-receiver/runtime/worker"

const adminBase = process.env.CUSTOMER_RECEIVER_RUNTIME_TEST_DATABASE_URL
// In CI the gate is required: a missing database must fail, not skip.
if (process.env.CUSTOMER_RECEIVER_RUNTIME_DB_GATE === "required" && !adminBase) throw new Error("CUSTOMER_RECEIVER_RUNTIME_TEST_DATABASE_URL is required for this gate")
const DB_NAME = "customer_receiver_runtime_test"
const ORG_A = "receiver-org-a"
const ORG_B = "receiver-org-b"
const SECRET_NAME = "Probe Customer Secret LLC"
const SECRET_EMAIL = "owner@probe-secret.invalid"
const ON: RuntimeSwitches = { capture: true, delivery: true }

function urlFor(user: string, password: string, database = DB_NAME) {
  const url = new URL(adminBase!)
  url.username = user
  url.password = password
  url.pathname = `/${database}`
  return url.toString()
}

function execFile(url: string, path: string) {
  const result = spawnSync("node_modules/.bin/prisma", ["db", "execute", "--url", url, "--file", path], { encoding: "utf8", env: process.env })
  if (result.status !== 0) throw new Error(`${path} failed\n${result.stdout}\n${result.stderr}`)
}

function client(url: string) {
  return new PrismaClient<Prisma.PrismaClientOptions>({ datasources: { db: { url } } })
}

describe.skipIf(!adminBase)("customer receiver runtime on PostgreSQL", () => {
  let root!: PrismaClient
  let admin!: PrismaClient
  let app!: PrismaClient
  let operator!: PrismaClient
  let db!: ReceiverDatabase<CaptureTransaction>
  let profile!: BuilderProfile
  let binding!: RuntimeBinding
  const sent: ReceiverSendRequest[] = []
  const previousKey = process.env.TENANT_PII_MASTER_KEY

  const rows: Record<string, Record<string, unknown>> = {
    "company:cmp-1": { id: "cmp-1", organizationId: ORG_A, name: SECRET_NAME, country: "az", email: SECRET_EMAIL, createdAt: new Date("2026-10-01T00:00:00Z") },
    "company:cmp-2": { id: "cmp-2", organizationId: ORG_A, name: "Second Customer", country: "AZ", email: null },
    "deal:deal-1": { id: "deal-1", organizationId: ORG_A, companyId: "cmp-1", name: "Probe deal", stage: "WON", valueAmount: "1500.0000", currency: "azn", expectedClose: new Date("2026-11-01T00:00:00Z") },
    "company:cmp-bad": { id: "cmp-bad", organizationId: ORG_A, name: "No country", country: null },
  }
  const reader: BuilderSourceReader = {
    find: async (entity, input) => {
      const row = rows[`${entity}:${input.id}`]
      if (!row || row.organizationId !== input.organizationId) return null
      return Object.fromEntries(input.fields.filter((key) => key in row).map((key) => [key, row[key]]))
    },
    customValues: async () => [],
  }

  const accept = async (request: ReceiverSendRequest) => {
    sent.push(request)
    const body = JSON.parse(request.body)
    return { status: 200, body: JSON.stringify({ status: "accepted", eventId: body.eventId, externalId: body.externalId, acceptedVersion: body.entityVersion, receiptId: `rcpt-${sent.length}`, operationId: `op-${sent.length}`, acceptedAt: "2026-10-14T10:00:00.000Z" }) }
  }

  const capture = (resource: "customers" | "deals", recordId: string, overrides: Partial<Parameters<typeof captureReceiverChange>[1]> = {}, extra?: (tx: CaptureTransaction) => Promise<void>) =>
    db.tenant(ORG_A, async (tx) => {
      if (extra) await extra(tx)
      return captureReceiverChange(tx, {
        binding, switches: ON, mode: "live", trigger: "change", resource, recordId,
        actor: { type: "user", id: "user-1" }, correlationId: `corr-${recordId}`, instanceId: "test", reader,
        catalogue: BUILDER_FIELDS, producerVersion: "test", ...overrides,
      })
    })
  const deliver = (overrides: Partial<Parameters<typeof runReceiverDelivery>[0]> = {}) =>
    runReceiverDelivery({ db, binding, switches: ON, send: accept, workerId: "worker-1", maxEffects: 10, sleep: async () => undefined, ...overrides })
  const effects = async (org = ORG_A) => (await admin.$queryRawUnsafe<{ id: string; status: string; payload: ReceiverEffectMetadata; attemptCount: number; lastError: string | null; providerResult: unknown }[]>(
    `SELECT "id"::text AS "id", "status", "payload", "attemptCount", "lastError", "providerResult" FROM "effect_outbox" WHERE "organizationId" = $1 ORDER BY "createdAt", "id"`, org))
  const attempts = async (effectId: string) => (await admin.$queryRawUnsafe<{ outcome: string; attemptNumber: number; evidence: Record<string, unknown> }[]>(
    `SELECT "outcome", "attemptNumber", "evidence" FROM "effect_attempts" WHERE "effectId" = $1::uuid ORDER BY "attemptNumber", "attemptedAt", "outcome" DESC`, effectId))
  const release = async () => admin.$executeRawUnsafe(`UPDATE "effect_outbox" SET "availableAt" = CURRENT_TIMESTAMP - INTERVAL '1 hour' WHERE "status" = 'pending'`)

  beforeAll(async () => {
    process.env.TENANT_PII_MASTER_KEY = randomBytes(32).toString("hex")
    resetMasterKekCache()
    root = client(adminBase!)
    await root.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`)
    await root.$executeRawUnsafe(`CREATE DATABASE ${DB_NAME}`)
    for (const statement of [
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'receiver_app') THEN CREATE ROLE receiver_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'receiver-app'; END IF; END $$`,
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'leaddrive_effect_operator') THEN CREATE ROLE leaddrive_effect_operator NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS; END IF; END $$`,
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'receiver_operator') THEN CREATE ROLE receiver_operator LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD 'receiver-operator'; END IF; END $$`,
      `GRANT leaddrive_effect_operator TO receiver_operator`,
      // A non-UTC session zone: the runtime must pin UTC itself.
      `ALTER ROLE receiver_app SET timezone = 'Europe/Berlin'`,
    ]) await root.$executeRawUnsafe(statement)
    admin = client(urlFor(new URL(adminBase!).username, decodeURIComponent(new URL(adminBase!).password)))
    for (const statement of [
      `GRANT CONNECT ON DATABASE ${DB_NAME} TO receiver_app, receiver_operator`,
      `GRANT USAGE ON SCHEMA public TO receiver_app, leaddrive_effect_operator`,
      `CREATE TABLE "organizations" ("id" TEXT PRIMARY KEY, "name" TEXT NOT NULL)`,
      `CREATE TABLE "funds" ("id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE)`,
      `ALTER TABLE "funds" OWNER TO receiver_app`,
      `CREATE TABLE "channel_configs" ("id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "channelType" TEXT NOT NULL, "isActive" BOOLEAN NOT NULL, "settings" JSONB NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE "receiver_probe_mutations" ("id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL)`,
      `GRANT SELECT ON "organizations", "channel_configs" TO receiver_app`,
      `GRANT SELECT, INSERT ON "receiver_probe_mutations" TO receiver_app`,
      `INSERT INTO "organizations" VALUES ('${ORG_A}', 'A'), ('${ORG_B}', 'B')`,
    ]) await admin.$executeRawUnsafe(statement)
    const adminUrl = urlFor(new URL(adminBase!).username, decodeURIComponent(new URL(adminBase!).password))
    execFile(adminUrl, "prisma/migrations/20260901090000_event_platform_foundation/migration.sql")
    execFile(adminUrl, "prisma/migrations/20261014150000_customer_receiver_runtime/migration.sql")

    profile = defaultBuilderProfile()
    profile.schedule.mode = "on_change"
    for (const resource of profile.resources) resource.selection.mode = "all"
    const settings = { builderVersion: "1.0", revision: 1, profile, history: [] }
    await admin.$executeRawUnsafe(`INSERT INTO "channel_configs" ("id", "organizationId", "channelType", "isActive", "settings") VALUES ('draft-1', $1, 'customer-receiver-draft', false, $2::jsonb)`, ORG_A, JSON.stringify(settings))
    binding = {
      integrationId: "aac-erp", organizationId: ORG_A, environment: "TEST", enabled: true, contractApproved: true, durableIdempotencyConfirmed: false,
      profile: { draftId: "draft-1", revision: 1, sha256: createHash("sha256").update(canonicalJson(profile)).digest("hex") },
      target: { origin: "https://receiver.test.internal", privateIpv4: "10.0.0.10" },
      credentials: { accessTokenFile: "/run/secrets/a", certificateFile: "/run/secrets/b", privateKeyFile: "/run/secrets/c", caFile: "/run/secrets/d" },
      payloadTtlHours: 72, securityLogRetentionDays: 90, pauseAfterUncertain: 2,
    }
    app = client(urlFor("receiver_app", "receiver-app"))
    operator = client(urlFor("receiver_operator", "receiver-operator"))
    db = { tenant: (org, work) => app.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT set_config('app.org_id', $1, true)`, org)
      return work(tx as unknown as CaptureTransaction)
    }, { timeout: 20_000 }) }
  }, 120_000)

  afterAll(async () => {
    await app?.$disconnect(); await operator?.$disconnect(); await admin?.$disconnect()
    if (root) {
      await root.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`).catch(() => undefined)
      await root.$disconnect()
    }
    if (previousKey === undefined) delete process.env.TENANT_PII_MASTER_KEY
    else process.env.TENANT_PII_MASTER_KEY = previousKey
    resetMasterKekCache()
  })

  it("does nothing without both switches, an approved binding and a live mode", async () => {
    await expect(capture("customers", "cmp-1", { switches: { capture: false, delivery: true } })).resolves.toEqual({ status: "disabled" })
    await expect(capture("customers", "cmp-1", { binding: { ...binding, contractApproved: false } })).resolves.toEqual({ status: "disabled" })
    await expect(capture("customers", "cmp-1", { mode: "replay" })).resolves.toEqual({ status: "fenced" })
    await expect(capture("customers", "cmp-1", { binding: { ...binding, profile: { ...binding.profile, sha256: "0".repeat(64) } } })).resolves.toMatchObject({ status: "profile_not_approved" })
    await expect(deliver({ switches: { capture: true, delivery: false } })).resolves.toMatchObject({ status: "disabled", claimed: 0 })
    expect(await effects()).toEqual([])
    expect(sent).toEqual([])
  })

  it("rolls the queue back with the CRM mutation and keeps personal data out of the ledger", async () => {
    await expect(db.tenant(ORG_A, async (tx) => {
      await tx.$executeRawUnsafe(`INSERT INTO "receiver_probe_mutations" VALUES ('rolled-back', $1)`, ORG_A)
      await captureReceiverChange(tx, { binding, switches: ON, mode: "live", trigger: "change", resource: "customers", recordId: "cmp-1", actor: { type: "user", id: "user-1" }, correlationId: "corr-rollback", instanceId: "test", reader, catalogue: BUILDER_FIELDS, producerVersion: "test" })
      throw new Error("CRM validation failed after capture")
    })).rejects.toThrow("CRM validation failed")
    const counts = await admin.$queryRawUnsafe<Record<string, bigint>[]>(`SELECT
      (SELECT count(*) FROM "receiver_probe_mutations") AS mutations, (SELECT count(*) FROM "effect_outbox") AS effects,
      (SELECT count(*) FROM "customer_receiver_payloads") AS payloads, (SELECT count(*) FROM "domain_events") AS events,
      (SELECT count(*) FROM "event_aggregate_heads") AS heads, (SELECT count(*) FROM "customer_receiver_security_events" WHERE "action" = 'submission_queued') AS queued`)
    expect(counts[0]).toEqual({ mutations: 0n, effects: 0n, payloads: 0n, events: 0n, heads: 0n, queued: 0n })

    const queued = await capture("customers", "cmp-1", {}, async (tx) => { await tx.$executeRawUnsafe(`INSERT INTO "receiver_probe_mutations" VALUES ('committed', $1)`, ORG_A) })
    expect(queued).toMatchObject({ status: "queued", entityVersion: 1 })
    const [effect] = await effects()
    expect(effect.status).toBe("pending")
    expect(effect.payload).toMatchObject({ resource: "customers", externalId: "cmp-1", entityVersion: 1, profile: { revision: 1 }, request: { method: "PUT", path: "/integration/v1/customers/cmp-1" } })
    const ledger = JSON.stringify(await admin.$queryRawUnsafe(`SELECT e."payload", d."data", o."envelope", p."cipherText" FROM "effect_outbox" e
      JOIN "domain_events" d ON d."id" = e."sourceEventId" JOIN "event_outbox" o ON o."eventId" = d."id" JOIN "customer_receiver_payloads" p ON p."effectId" = e."id"`))
    expect(ledger).not.toContain(SECRET_NAME)
    expect(ledger).not.toContain(SECRET_EMAIL)
    const [payload] = await admin.$queryRawUnsafe<{ expiresAt: Date; createdAt: Date }[]>(`SELECT "expiresAt", "createdAt" FROM "customer_receiver_payloads"`)
    expect(payload.expiresAt.getTime() - payload.createdAt.getTime()).toBe(72 * 3600 * 1000)
    // Stored as naive UTC despite the Europe/Berlin session.
    expect(Math.abs(payload.createdAt.getTime() - Date.now())).toBeLessThan(5 * 60 * 1000)
  })

  it("isolates tenants and refuses records the profile would reject", async () => {
    const foreign = await db.tenant(ORG_B, async (tx) => tx.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM "effect_outbox" UNION ALL SELECT 1 FROM "customer_receiver_payloads" UNION ALL SELECT 1 FROM "customer_receiver_security_events"`))
    expect(foreign).toEqual([])
    await expect(db.tenant(ORG_B, (tx) => captureReceiverChange(tx, { binding, switches: ON, mode: "live", trigger: "change", resource: "customers", recordId: "cmp-1", actor: { type: "user", id: "user-1" }, correlationId: "corr-x", instanceId: "test", reader, catalogue: BUILDER_FIELDS, producerVersion: "test" }))).rejects.toThrow()
    await expect(capture("customers", "cmp-bad")).resolves.toMatchObject({ status: "invalid", code: "required_value_missing" })
    await expect(capture("customers", "missing")).resolves.toMatchObject({ status: "invalid", code: "source_not_found" })
    const manual = structuredClone(profile)
    manual.resources[0].selection.mode = "manual"
    await admin.$executeRawUnsafe(`UPDATE "channel_configs" SET "settings" = $1::jsonb WHERE "id" = 'draft-1'`, JSON.stringify({ builderVersion: "1.0", revision: 2, profile: manual, history: [{ revision: 1, profile, recordedAt: "2026-10-14T00:00:00.000Z" }] }))
    // A later draft edit does not change the approved revision used by capture…
    await expect(capture("customers", "cmp-2")).resolves.toMatchObject({ status: "queued" })
    // …and a binding moved to the manual revision needs an operator trigger.
    const manualBinding = { ...binding, profile: { draftId: "draft-1", revision: 2, sha256: createHash("sha256").update(canonicalJson(manual)).digest("hex") } }
    await expect(capture("customers", "cmp-2", { binding: manualBinding })).resolves.toMatchObject({ status: "not_selected", code: "not_on_change" })
    expect((await effects()).length).toBe(2)
  })

  it("delivers frozen bytes once, in dependency order, with committed started evidence", async () => {
    // Deal captured while its customer's version is still unaccepted.
    await capture("deals", "deal-1")
    await admin.$executeRawUnsafe(`UPDATE "effect_outbox" SET "availableAt" = CURRENT_TIMESTAMP - INTERVAL '2 hours' WHERE "payload"->>'resource' = 'deals'`)
    const first = await deliver()
    expect(first).toMatchObject({ status: "completed", deferred: 1, succeeded: 2, failed: 0, uncertain: 0 })
    let all = await effects()
    const deal = all.find((entry) => entry.payload.resource === "deals")!
    expect(deal).toMatchObject({ status: "pending", lastError: "customer_version_not_accepted" })
    expect(deal.payload.dependsOn).toEqual({ resource: "customers", externalId: "cmp-1", minimumVersion: 1 })
    await release()
    expect(await deliver()).toMatchObject({ succeeded: 1, deferred: 0 })
    all = await effects()
    expect(all.map((entry) => entry.status)).toEqual(["succeeded", "succeeded", "succeeded"])
    expect(all[0].providerResult).toMatchObject({ status: "accepted_by_api", receiptId: "rcpt-1" })
    expect(sent.map((request) => request.path)).toEqual(["/integration/v1/customers/cmp-1", "/integration/v1/customers/cmp-2", "/integration/v1/deals/deal-1"])
    for (const effect of all) {
      const request = sent.find((entry) => entry.path === effect.payload.request.path)!
      expect(createHash("sha256").update(request.body).digest("hex")).toBe(effect.payload.request.bodySha256)
      expect(request.idempotencyKey).toBe(effect.payload.request.idempotencyKey)
      expect((await attempts(effect.id)).map((attempt) => attempt.outcome).sort()).toEqual(["started", "succeeded"])
    }
    expect(JSON.parse(sent[0].body)).toMatchObject({ customer: { name: SECRET_NAME, countryCode: "AZ", email: SECRET_EMAIL } })
  })

  it("parks ambiguous outcomes for reconciliation, pauses the destination and never resends blindly", async () => {
    sent.length = 0
    rows["company:cmp-1"].name = "Version two"
    await capture("customers", "cmp-1")
    await capture("customers", "cmp-2")
    const timeout = await deliver({ send: async (request) => { sent.push(request); throw new Error("socket hang up") } })
    expect(timeout).toMatchObject({ uncertain: 1, stoppedBy: "transport_error" })
    const failing = async (request: ReceiverSendRequest) => { sent.push(request); return { status: 503, body: "" } }
    expect(await deliver({ send: failing })).toMatchObject({ uncertain: 1, stoppedBy: "receiver_error" })
    // Two unresolved ambiguous outcomes reach pauseAfterUncertain=2.
    rows["company:cmp-2"].name = "Version two b"
    await capture("customers", "cmp-2")
    expect(await deliver()).toMatchObject({ status: "paused", claimed: 0 })
    expect(sent.length).toBe(2)
    const uncertain = (await effects()).filter((entry) => entry.status === "reconciliation_required")
    expect(uncertain.length).toBe(2)
    expect((await attempts(uncertain[0].id)).map((entry) => entry.outcome).sort()).toEqual(["reconciliation_required", "started"])

    // The application role cannot decide; the operator can, with evidence.
    await expect(db.tenant(ORG_A, (tx) => tx.$executeRawUnsafe(`UPDATE "effect_outbox" SET "status" = 'pending', "providerRequestId" = NULL, "reconciliationAt" = NULL, "lastError" = NULL WHERE "id" = $1::uuid`, uncertain[0].id))).rejects.toThrow()
    await operator.$transaction((tx) => reconcileReceiverEffect(tx, { organizationId: ORG_A, effectId: uncertain[0].id, decision: "succeeded", reason: "receiver receipt lookup found the event", evidence: { lookup: "found", ticket: "INC-1" }, providerReference: "rcpt-lookup-1", operatorId: "ops-1", retentionDays: 90 }))
    await operator.$transaction((tx) => reconcileReceiverEffect(tx, { organizationId: ORG_A, effectId: uncertain[1].id, decision: "retry", reason: "receiver confirmed the event is absent", evidence: { lookup: "absent", ticket: "INC-2" }, operatorId: "ops-1", retentionDays: 90 }))
    // The retried v2 goes first; v3 of the same record waits for it.
    expect(await deliver()).toMatchObject({ succeeded: 1, deferred: 1 })
    await release()
    expect(await deliver()).toMatchObject({ succeeded: 1 })
    const retried = sent.filter((request) => request.path === "/integration/v1/customers/cmp-2")
    // Same frozen submission on retry: identical bytes and idempotency key.
    expect(retried[1].body).toBe(retried[0].body)
    expect(retried[1].idempotencyKey).toBe(retried[0].idempotencyKey)
    expect((await effects()).every((entry) => entry.status === "succeeded")).toBe(true)
  })

  it("recovers expired leases by evidence: requeue without started, reconciliation after started", async () => {
    sent.length = 0
    rows["company:cmp-1"].name = "Version three"
    await capture("customers", "cmp-1")
    // A crashed claimant: leased, no started row.
    await db.tenant(ORG_A, async (tx) => {
      await tx.$queryRawUnsafe(`SELECT set_config('TimeZone', 'UTC', true)`)
      await tx.$executeRawUnsafe(`UPDATE "effect_outbox" SET "status" = 'leased', "attemptCount" = "attemptCount" + 1, "leaseToken" = gen_random_uuid(), "leaseOwner" = 'dead-worker', "leaseExpiresAt" = CURRENT_TIMESTAMP + INTERVAL '1 second', "providerRequestId" = 'req-dead' WHERE "status" = 'pending'`)
    })
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(await deliver()).toMatchObject({ recoveredToPending: 1, succeeded: 1 })

    // A claimant whose lease expires during the call: the competing run marks
    // it ambiguous and the slow worker's late evidence is refused.
    rows["company:cmp-1"].name = "Version four"
    await capture("customers", "cmp-1")
    let releaseSlow!: () => void
    const slow = deliver({ leaseSeconds: 1, send: async (request) => { sent.push(request); await new Promise<void>((resolve) => { releaseSlow = resolve }); return accept(request) } })
    await new Promise((resolve) => setTimeout(resolve, 1800))
    expect(await deliver({ workerId: "worker-2" })).toMatchObject({ recoveredToReconciliation: 1, claimed: 0 })
    releaseSlow()
    expect(await slow).toMatchObject({ stoppedBy: "evidence_not_recorded" })
    const last = (await effects()).at(-1)!
    expect(last.status).toBe("reconciliation_required")
    expect((await attempts(last.id)).map((entry) => entry.outcome).sort()).toEqual(["reconciliation_required", "started"])
    await operator.$transaction((tx) => reconcileReceiverEffect(tx, { organizationId: ORG_A, effectId: last.id, decision: "succeeded", reason: "late receipt matched", evidence: { lookup: "found" }, providerReference: "rcpt-late", operatorId: "ops-1", retentionDays: 90 }))
  })

  it("gives one claimant per effect under concurrent workers", async () => {
    sent.length = 0
    for (let index = 0; index < 6; index++) {
      rows[`company:cmp-c${index}`] = { id: `cmp-c${index}`, organizationId: ORG_A, name: `Concurrent ${index}`, country: "AZ" }
      await capture("customers", `cmp-c${index}`)
    }
    const runs = await Promise.all([deliver({ workerId: "w-a" }), deliver({ workerId: "w-b" }), deliver({ workerId: "w-c" })])
    expect(runs.reduce((sum, run) => sum + run.succeeded, 0)).toBe(6)
    const keys = sent.map((request) => request.idempotencyKey)
    expect(keys.length).toBe(6)
    expect(new Set(keys).size).toBe(6)
    for (const effect of (await effects()).filter((entry) => entry.payload.externalId.startsWith("cmp-c"))) {
      expect(effect.attemptCount).toBe(1)
      expect((await attempts(effect.id)).map((entry) => entry.outcome).sort()).toEqual(["started", "succeeded"])
    }
  })

  it("bounds personal payloads: TTL purge, incident hold, and no send once the payload is gone", async () => {
    sent.length = 0
    rows["company:cmp-1"].name = "Version five"
    await capture("customers", "cmp-1")
    rows["company:cmp-1"].name = "Version five hold"
    const held = await capture("customers", "cmp-1")
    // Neither the application nor the owner can rewrite or early-delete.
    await expect(db.tenant(ORG_A, (tx) => tx.$executeRawUnsafe(`DELETE FROM "customer_receiver_payloads"`))).rejects.toThrow()
    await expect(admin.$executeRawUnsafe(`UPDATE "customer_receiver_payloads" SET "cipherText" = repeat('A', 64)`)).rejects.toThrow()
    await expect(db.tenant(ORG_A, (tx) => tx.$executeRawUnsafe(`TRUNCATE "customer_receiver_payloads"`))).rejects.toThrow()
    // Age every pending payload past its TTL (test-only trigger bypass).
    const holdEffect = held.status === "queued" ? held.effectId : ""
    await admin.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`)
      await tx.$executeRawUnsafe(`UPDATE "customer_receiver_payloads" SET "createdAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - CASE WHEN "effectId" = $1::uuid THEN INTERVAL '3 days' ELSE INTERVAL '4 days' END,
        "expiresAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '1 day'
        WHERE "effectId" IN (SELECT "id" FROM "effect_outbox" WHERE "status" = 'pending')`, holdEffect)
    })
    await db.tenant(ORG_A, async (tx) => {
      const createdAt = (await tx.$queryRawUnsafe<{ createdAt: Date }[]>(`SELECT "createdAt" FROM "customer_receiver_payloads" WHERE "effectId" = $1::uuid`, holdEffect))[0].createdAt
      await placeReceiverIncidentHold(tx, { organizationId: ORG_A, integrationId: "aac-erp", environment: "TEST", from: createdAt, to: new Date(createdAt.getTime() + 1), holdUntil: new Date(Date.now() + 86400_000), reason: "inc-42" })
    })
    await expect(db.tenant(ORG_A, (tx) => tx.$executeRawUnsafe(`UPDATE "customer_receiver_payloads" SET "holdUntil" = CURRENT_TIMESTAMP WHERE "effectId" = $1::uuid`, holdEffect))).rejects.toThrow()
    expect(await db.tenant(ORG_A, (tx) => purgeExpiredReceiverPayloads(tx, { organizationId: ORG_A, limit: 100 }))).toBe(1)
    // Purged → missing; held but expired → kept for the incident, never sent.
    expect(await deliver()).toMatchObject({ failed: 2, succeeded: 0 })
    expect(sent.length).toBe(0)
    const failed = (await effects()).filter((entry) => entry.status === "definitely_failed")
    expect(failed.map((entry) => entry.lastError).sort()).toEqual(["payload_expired", "payload_missing"])
    for (const effect of failed) expect((await attempts(effect.id)).map((entry) => entry.evidence.networkCall)).toEqual([false, false])
    const remaining = await admin.$queryRawUnsafe<{ holdReason: string }[]>(`SELECT "holdReason" FROM "customer_receiver_payloads" WHERE "effectId" = $1::uuid`, holdEffect)
    expect(remaining).toEqual([{ holdReason: "inc-42" }])
  })

  it("rejects a definite failure without retrying, then lets only the operator retry it", async () => {
    sent.length = 0
    rows["company:cmp-2"].name = "Rejected once"
    await capture("customers", "cmp-2")
    const reject = async (request: ReceiverSendRequest) => { sent.push(request); return { status: 422, body: "{\"error\":\"secret details\"}" } }
    expect(await deliver({ send: reject })).toMatchObject({ failed: 1 })
    const failed = (await effects()).at(-1)!
    expect(failed).toMatchObject({ status: "definitely_failed", lastError: "invalid_data" })
    expect(await deliver()).toMatchObject({ claimed: 0 })
    await expect(db.tenant(ORG_A, (tx) => tx.$executeRawUnsafe(`UPDATE "effect_outbox" SET "status" = 'pending', "providerRequestId" = NULL WHERE "id" = $1::uuid`, failed.id))).rejects.toThrow()
    await operator.$transaction((tx) => reconcileReceiverEffect(tx, { organizationId: ORG_A, effectId: failed.id, decision: "retry", reason: "mapping fixed on receiver side", evidence: { ticket: "INC-7" }, operatorId: "ops-1", retentionDays: 90 }))
    expect(await deliver()).toMatchObject({ succeeded: 1 })
    expect(sent.length).toBe(2)
  })

  it("keeps an append-only, value-free security log readable only by its tenant", async () => {
    const log = await db.tenant(ORG_A, (tx) => readRuntimeSecurityEvents(tx, { organizationId: ORG_A, environment: "TEST", from: "2026-01-01T00:00:00Z", to: "2100-01-01T00:00:00Z", limit: 5000 }))
    expect(log.truncated).toBe(false)
    const actions = new Set(log.events.map((event) => event.action))
    for (const action of ["submission_queued", "submission_skipped", "submission_attempted", "submission_accepted", "submission_rejected", "submission_uncertain", "submission_deferred", "lease_recovered", "receipt_lookup"]) expect(actions).toContain(action)
    const text = JSON.stringify(log.events)
    for (const secret of [SECRET_NAME, SECRET_EMAIL, "Version", "secret details", "socket hang up"]) expect(text).not.toContain(secret)
    expect(log.events.every((event) => event.organization_id === ORG_A && event.source.service === "receiver-runtime")).toBe(true)
    await expect(db.tenant(ORG_A, (tx) => tx.$executeRawUnsafe(`UPDATE "customer_receiver_security_events" SET "outcome" = 'success'`))).rejects.toThrow()
    await expect(db.tenant(ORG_A, (tx) => tx.$executeRawUnsafe(`DELETE FROM "customer_receiver_security_events"`))).rejects.toThrow()
    const foreign = await db.tenant(ORG_B, (tx) => readRuntimeSecurityEvents(tx, { organizationId: ORG_A, environment: "TEST", from: "2026-01-01T00:00:00Z", to: "2100-01-01T00:00:00Z", limit: 10 }))
    expect(foreign.events).toEqual([])
  })
})
