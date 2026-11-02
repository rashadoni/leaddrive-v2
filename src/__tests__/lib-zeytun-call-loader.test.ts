import { describe, expect, it } from "vitest"

import { getRlsContext, runWithRlsBypass } from "@/lib/rls-context"
import { createZeytunCallLoader, type ZeytunCallDatabase } from "@/lib/voice-agent/pharmacy/zeytun-call-loader"

const config = { organizationId: "tenant-test", channelConfigId: "line-test" }
const lookup = { ...config, provider: "asterisk" as const, providerCallId: "cccccccc-1111-4222-8333-444444444444" }
const now = Date.parse("2026-10-22T12:00:00.000Z")
function row() {
  return {
    startedAt: new Date(now),
    call: { id: "call-log-test", ...lookup, callMode: "ai", direction: "inbound", status: "in-progress", wasAnswered: true,
      fromNumber: "+994500000001", toNumber: "+994500000002", targetPhoneE164: "+994500000001",
      contactId: "contact-test", companyId: "company-test", leadId: null, endedAt: null },
    channel: { id: config.channelConfigId, organizationId: config.organizationId, channelType: "voip", isActive: true,
      settings: { provider: "asterisk", voiceAgentEnabled: true } },
    subject: { kind: "contact", id: "contact-test", organizationId: config.organizationId, companyId: "company-test", isActive: true },
    company: { id: "company-test", organizationId: config.organizationId, status: "active" },
  }
}
function database(initial: unknown = [row()]) {
  const state = { rows: initial, error: null as Error | null, clock: now,
    transactions: [] as unknown[], queries: [] as { sql: string; values: unknown[]; rls: unknown }[] }
  const db: ZeytunCallDatabase = {
    async $transaction(read, options) {
      state.transactions.push(options)
      return read({ async $queryRaw<T>(sql: TemplateStringsArray, ...values: unknown[]): Promise<T> {
        state.queries.push({ sql: sql.join("?"), values, rls: getRlsContext() })
        if (state.error) throw state.error
        if (sql.join("").includes("WITH candidates")) return structuredClone(state.rows) as T
        return [] as T
      } })
    },
  }
  return { state, db, load: createZeytunCallLoader(config, db, () => state.clock) }
}

describe("tenant-scoped coherent CRM call reader", () => {
  it("returns a validated contact call with an ISO date and a bounded transaction", async () => {
    const { load, state } = database()
    const result = await load(lookup)
    expect(result?.call.startedAt).toBe("2026-10-22T12:00:00.000Z")
    expect(result?.subject).toMatchObject({ kind: "contact", id: "contact-test" })
    expect(state.transactions).toEqual([{ isolationLevel: "ReadCommitted", maxWait: 500, timeout: 2500 }])
    expect(state.queries).toHaveLength(2)
    expect(state.queries.every((q) => JSON.stringify(q.rls) === JSON.stringify({ orgId: config.organizationId }))).toBe(true)
    expect(state.queries[0].sql).toContain("set_config('app.rls_bypass', 'off', true)")
    expect(state.queries[0].sql).toContain("'statement_timeout', '1500ms'")
    expect(state.queries[0].values).toEqual([config.organizationId])
    expect(state.queries[1].values).toEqual([config.organizationId, lookup.providerCallId, config.channelConfigId])
    expect(state.queries[1].sql).toContain('org."isActive" = true')
    expect(state.queries[1].sql).not.toMatch(/SELECT\s+\*|transcription|recordingUrl|apiKey|password|phoneNumber|ch\.settings\s+AS/)
  })
  it("supports a separately reviewed lead-only outbound projection only when already answered", async () => {
    const record = row()
    const data = { ...record, call: { ...record.call, direction: "outbound", contactId: null, companyId: null, leadId: "lead-test",
      fromNumber: "+994500000002", toNumber: "+994500000001" },
      subject: { kind: "lead", id: "lead-test", organizationId: config.organizationId, status: "qualified" }, company: null }
    const { load, state } = database([data])
    expect((await load(lookup))?.subject.kind).toBe("lead")
    state.rows = [{ ...data, call: { ...data.call, status: "initiated", wasAnswered: false } }]
    expect(await load(lookup)).toBeNull()
  })
  it("overrides a surrounding admin scope during reads, then restores the outer context", async () => {
    const { load, state } = database()
    await runWithRlsBypass(async () => {
      expect(getRlsContext()).toEqual({ bypass: true })
      await load(lookup)
      expect(getRlsContext()).toEqual({ bypass: true })
    })
    expect(state.queries.every((q) => JSON.stringify(q.rls) === JSON.stringify({ orgId: config.organizationId }))).toBe(true)
  })
  it("rejects invalid or cross-tenant/line lookup before accessing the database", async () => {
    const { load, state } = database()
    for (const changed of [
      { organizationId: "other" }, { channelConfigId: "other" }, { providerCallId: "invalid-id" },
      { provider: "twilio" }, { customerGuid: "model-selected" },
    ]) expect(await load({ ...lookup, ...changed } as typeof lookup)).toBeNull()
    expect(state.transactions).toHaveLength(0)
    expect(() => createZeytunCallLoader({ ...config, organizationId: "" }, database().db)).toThrow("invalid_call_loader_configuration")
  })
  it.each([[], [row(), row()], null, { data: row() }])("rejects zero/multiple or unsupported row results %#", async (rows) => {
    expect(await database(rows).load(lookup)).toBeNull()
  })
  it.each([
    { organizationId: "other" }, { channelConfigId: "other-line" }, { providerCallId: "bbbbbbbb-1111-4222-8333-444444444444" },
    { status: "completed" }, { wasAnswered: false }, { endedAt: "2026-10-22T12:00:01.000Z" },
    { contactId: "other-contact" }, { companyId: "other-company" }, { leadId: "also-lead" },
    { targetPhoneE164: "+994500000003" },
  ])("revalidates returned call data instead of trusting a DB row %j", async (patch) => {
    const data = row()
    expect(await database([{ ...data, call: { ...data.call, ...patch } }]).load(lookup)).toBeNull()
  })
  it("refuses inactive/cross-tenant related records and wrong company relationships", async () => {
    const data = row()
    for (const patch of [
      { channel: { ...data.channel, isActive: false } }, { channel: { ...data.channel, organizationId: "other" } },
      { subject: { ...data.subject, isActive: false } }, { subject: { ...data.subject, organizationId: "other" } },
      { company: { ...data.company, status: "inactive" } }, { company: { ...data.company, organizationId: "other" } },
      { subject: { ...data.subject, companyId: "other-company" } }, { company: null },
    ]) expect(await database([{ ...data, ...patch }]).load(lookup)).toBeNull()
  })
  it("re-reads each time, fails on closure and checks elapsed time after the read", async () => {
    const { load, state } = database()
    expect(await load(lookup)).not.toBeNull()
    state.clock += 2 * 60 * 60_000
    expect(await load(lookup)).toBeNull()
    state.clock = now
    const data = row(); state.rows = [{ ...data, call: { ...data.call, endedAt: new Date(now).toISOString() } }]
    expect(await load(lookup)).toBeNull()
    expect(state.transactions).toHaveLength(3)
  })
  it("requires driver Date values without guessing a timezone and rejects future starts", async () => {
    for (const startedAt of [null, "2026-10-22 12:00:00", new Date(NaN), new Date(now + 1)]) {
      expect(await database([{ ...row(), startedAt }]).load(lookup)).toBeNull()
    }
  })
  it("parameterizes server identity rather than interpolating it into SQL", async () => {
    const { db, state } = database([])
    const scoped = { ...config, organizationId: "tenant'; SELECT private_data; --" }
    await createZeytunCallLoader(scoped, db)({ ...lookup, ...scoped })
    for (const query of state.queries) {
      expect(query.sql).not.toContain(scoped.organizationId)
      expect(query.values).toContain(scoped.organizationId)
    }
  })
  it("masks SQL/timeouts and performs no retries", async () => {
    const { load, state } = database()
    state.error = new Error("connection password and private customer")
    await expect(load(lookup)).rejects.toThrow(/^call_context_unavailable$/)
    expect(state.transactions).toHaveLength(1)
  })
})
