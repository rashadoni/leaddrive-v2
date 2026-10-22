import { createHash } from "node:crypto"
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createInboundPilotHost } from "@/lib/voice-agent/pharmacy/zeytun-inbound-host"
import { type InboundPilotCall, type InboundPilotConfig } from "@/lib/voice-agent/pharmacy/zeytun-inbound-pilot"
import { type ZeytunCallDatabase } from "@/lib/voice-agent/pharmacy/zeytun-call-loader"
import { ZeytunSnapshotStore } from "@/lib/voice-agent/pharmacy/zeytun-snapshot-store"
import { getRlsContext, runWithRlsBypass } from "@/lib/rls-context"
import { payload } from "./fixtures/zeytun-balances"

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "zeytun-inbound-host-")); roots.push(root)
  const configFile = join(root, "grant.json"), snapshotDirectory = join(root, "catalog")
  const bytes = Buffer.from(payload()), version = createHash("sha256").update(bytes).digest("hex")
  const config: InboundPilotConfig = {
    version: 1, enabled: true, purpose: "owner_inbound_preview", id: "aaaaaaaa-1111-4111-8111-111111111111",
    organizationId: "tenant-test", channelConfigId: "line-test", testPhoneE164: "+994500000001",
    issuedAt: "2026-10-22T12:00:00Z", expiresAt: "2026-10-22T12:20:00Z", approvalReference: "synthetic-approval",
    approvedSource: { organizationId: "inspection-test", scopeKey: "a".repeat(64), catalogVersion: version },
  }
  const call: InboundPilotCall = { id: "call-test", organizationId: config.organizationId, channelConfigId: config.channelConfigId,
    providerCallId: "bbbbbbbb-1111-4111-8111-111111111111", provider: "asterisk", direction: "inbound", callMode: "ai",
    status: "in-progress", wasAnswered: true, endedAt: null, startedAt: config.issuedAt,
    fromNumber: config.testPhoneE164, targetPhoneE164: config.testPhoneE164 }
  const state = { rows: [{ ...call, startedAt: new Date(call.startedAt) }] as unknown[],
    writes: [{ id: call.id }], queries: [] as { sql: string; values: unknown[]; rls: unknown }[] }
  const database: ZeytunCallDatabase = { async $transaction(read) {
    return read({ async $queryRaw<T>(parts: TemplateStringsArray, ...values: unknown[]) {
      const sql = parts.join("?"); state.queries.push({ sql, values, rls: getRlsContext() })
      return (sql.includes("WITH candidates") ? state.rows : sql.includes("UPDATE call_logs") ? (state.writes.length ? [{ id: values[1] }] : []) : []) as T
    } })
  } }
  const options = { configFile, snapshotDirectory, runtimeOrganizationId: config.organizationId, database }
  await writeFile(configFile, JSON.stringify(config), { mode: 0o600 })
  await new ZeytunSnapshotStore(snapshotDirectory, config.approvedSource.organizationId, config.approvedSource.scopeKey).save({
    payload: bytes, version, context: { organizationId: config.approvedSource.organizationId, observedAt: config.issuedAt, source: "live" },
  })
  return { root, configFile, config, call, state, options, host: createInboundPilotHost(options) }
}

describe("private inbound pilot host", () => {
  it("reads a private grant, permits explicit disabling and rejects public/symlink files", async () => {
    const f = await fixture()
    expect(await f.host.loadConfig()).toEqual(f.config)
    await chmod(f.configFile, 0o644)
    await expect(f.host.loadConfig()).rejects.toThrow()
    await chmod(f.configFile, 0o600)
    await writeFile(f.configFile, JSON.stringify({ enabled: false }))
    expect(await f.host.loadConfig()).toBeNull()
    const link = join(f.root, "link.json"); await symlink(f.configFile, link)
    await expect(createInboundPilotHost({ ...f.options, configFile: link }).loadConfig()).rejects.toThrow()
    expect(await createInboundPilotHost({ ...f.options, configFile: "" }).loadConfig()).toBeNull()
  })
  it("binds one grant to one call across host instances and persists the sales-analysis exclusion", async () => {
    const f = await fixture(), second = createInboundPilotHost(f.options)
    const other = { ...f.call, id: "other-call", providerCallId: "cccccccc-1111-4111-8111-111111111111" }
    const claims = await Promise.all([f.host.claim(f.config, f.call), second.claim(f.config, other)])
    expect(claims.filter(Boolean)).toHaveLength(1)
    const winner = claims[0] ? f.call : other
    expect(await second.isClaimed(f.config, winner)).toBe(true)
    expect(await second.claim(f.config, { ...f.call, id: "wrong-log" })).toBe(false)
    const writes = f.state.queries.filter(q => q.sql.includes("UPDATE call_logs"))
    expect(writes).toHaveLength(1)
    expect(writes[0].sql).toContain('"endedAt" IS NULL')
    expect(writes[0].sql).toContain("jsonb_build_object('pharmacyInboundPreview'")
    expect(writes[0].values).toContain(f.config.organizationId)
    expect(writes[0].values).not.toContain(f.config.testPhoneE164)
    const persisted = await readFile(join(f.root, `inbound-${f.config.id}.claim`), "utf8")
    expect(persisted).not.toContain(f.config.testPhoneE164)
  })
  it("refuses to open a session when the durable test marker cannot be written", async () => {
    const f = await fixture(); f.state.writes = []
    expect(await f.host.claim(f.config, f.call)).toBe(false)
  })
  it("queries the runtime tenant under RLS without loading CRM history", async () => {
    const f = await fixture()
    const actual = await runWithRlsBypass(() => f.host.loadCall(f.config, f.call.providerCallId))
    expect(actual).toEqual({ ...f.call, startedAt: new Date(f.call.startedAt).toISOString() })
    expect(f.state.queries.every(q => JSON.stringify(q.rls) === JSON.stringify({ orgId: f.config.organizationId }))).toBe(true)
    expect(f.state.queries[1].values).toEqual([f.config.organizationId, f.call.providerCallId, f.config.channelConfigId])
    expect(f.state.queries[1].sql).not.toMatch(/contacts|leads|companies|transcription|password/)
    f.state.queries = []
    expect(await f.host.loadCall({ ...f.config, organizationId: "wrong" }, f.call.providerCallId)).toBeNull()
    expect(f.state.queries).toHaveLength(0)
    f.state.rows = []
    expect(await f.host.loadCall(f.config, f.call.providerCallId)).toBeNull()
  })
  it("parses the pinned catalog once and does not reread a changed file during a call", async () => {
    const f = await fixture(), first = await f.host.loadCatalog(f.config)
    const snapshot = join(f.options.snapshotDirectory, `${f.config.approvedSource.scopeKey}.snapshot`)
    await writeFile(snapshot, "corrupt")
    expect(await f.host.loadCatalog(f.config)).toBe(first)
    expect(first.search({ text: "Тестмедин" }).candidateCount).toBe(1)
    await expect(createInboundPilotHost(f.options).loadCatalog(f.config)).rejects.toThrow()
  })
})
