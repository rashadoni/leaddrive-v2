import { describe, expect, it } from "vitest"
import type { DomainEventEnvelope } from "../lib/event-platform/envelope"
import type { KafkaEventRecord } from "../lib/event-platform/consumer"
import { consumeFundShadowRecord, type FundShadowDatabase, type FundShadowScope, type FundShadowTransaction } from "../lib/event-platform/fund-shadow-consumer"

const scope: FundShadowScope = Object.freeze({ organizationId: "tenant-a", buildId: "70000000-0000-4000-8000-000000000001",
  buildKey: "shadow-build-a", projectionVersion: 2, codeSha: "c".repeat(40), environment: "test", expectedWorkerRole: "fund_shadow_a" })
const HASH = "a".repeat(64) // Mocked PG output, NOT a claim to compute jsonb SHA in JS.

function fact(version = 1, data: Record<string, string> = {}): DomainEventEnvelope {
  const opening = version === 1
  return { specversion: "1.0", datacontenttype: "application/json", id: `10000000-0000-4000-8000-${String(version).padStart(12, "0")}`,
    source: "urn:leaddrive:finance", type: opening ? "finance.fund-opened.v1" : "finance.fund-transaction-recorded.v1",
    dataschema: opening ? "urn:leaddrive:schema:finance.fund-opened:v1" : "urn:leaddrive:schema:finance.fund-transaction-recorded:v1",
    organizationid: "tenant-a", aggregatetype: "fund", aggregateid: "fund-a", aggregateversion: version,
    time: "2026-10-18T00:00:00.000Z", correlationid: "fixture-command", producer: "fixture", producerversion: "v1", classification: "confidential",
    data: opening ? { fundId: "fund-a", currency: "USD", openingBalance: "10.0000", ...data }
      : { fundId: "fund-a", currency: "USD", transactionId: `tx-${version}`, transactionType: "deposit", amount: "1.0000", signedDelta: "1.0000", ...data } }
}

function record(version = 1, sourceOffset = version - 1, event = fact(version)): KafkaEventRecord {
  return { topic: "ld.test.finance.events.v1", partition: 0, offset: String(sourceOffset), key: `${event.organizationid}:fund:${event.aggregateid}`,
    value: JSON.stringify(event), headers: { id: event.id, eventtype: event.type, organizationid: event.organizationid, payloadhash: HASH } }
}

interface MockInbox {
  organizationId: string; consumerName: string; consumerVersion: number; eventId: string; eventType: string; payloadHash: string
  sourceTopic: string; sourcePartition: number; sourceOffset: string; result: unknown
}
interface MockShadow {
  organizationId: string; fundId: string; projectionVersion: number; buildKey: string; status: string; promotedAt: null | string
  balance: string; currency: string; aggregateVersion: string; lastEventId: string; evidence: Record<string, unknown>
}
interface MockState {
  inbox: MockInbox[]
  shadow: MockShadow | null
  checkpoint: { sourceOffset: string; lastEventId: string | null } | null
}
type Call = { label: string; sql: string; values: unknown[] }

/**
 * Control-flow harness ONLY. It does not implement SQL, RLS, locks, deferred
 * constraints or jsonb hashing, so these tests are not the real-PG gate.
 */
function harness() {
  const h = {
    state: { inbox: [], shadow: null, checkpoint: null } as MockState,
    build: { id: scope.buildId, organizationId: scope.organizationId, projectionName: "finance.fund-balance", projectionVersion: scope.projectionVersion,
      buildKey: scope.buildKey, codeSha: scope.codeSha, mode: "shadow", status: "running", effectsFenced: true, replayFrom: null, replayTo: null } as Record<string, unknown>,
    role: { currentRole: scope.expectedWorkerRole, sessionRole: scope.expectedWorkerRole, restricted: true },
    source: { payloadHash: HASH, incomingHash: HASH, sourceHash: HASH, exactEnvelope: true, parsedEnvelope: true } as Record<string, unknown>,
    sourcePresent: true,
    calls: [] as Call[], transactions: 0, commits: 0, rollbacks: 0,
    options: null as unknown, failAt: "", zeroAt: "", commitFailure: false,
    beforeCommit: async () => {},
  }
  const db: FundShadowDatabase = {
    async $transaction<T>(work: (tx: FundShadowTransaction) => Promise<T>, options: unknown): Promise<T> {
      h.transactions += 1
      h.options = options
      const draft = structuredClone(h.state)
      function call(sql: string, values: unknown[]): string {
        const label = /\/\* fund-shadow:([^ ]+) \*\//.exec(sql)?.[1]
        if (!label) throw new Error("Unlabelled SQL in test harness")
        h.calls.push({ label, sql, values })
        if (h.failAt === label) throw new Error(`injected ${label} failure`)
        return label
      }
      const tx: FundShadowTransaction = {
        async $queryRawUnsafe<T>(sql: string, ...values: unknown[]): Promise<T> {
          const label = call(sql, values)
          let result: unknown
          switch (label) {
            case "role": result = [h.role]; break
            case "tenant": result = []; break
            case "build": result = [h.build]; break
            case "source": {
              const event = JSON.parse(values[0] as string) as DomainEventEnvelope
              result = h.sourcePresent ? [{ eventType: event.type, topic: "leaddrive.domain.finance.v1",
                partitionKey: `${event.organizationid}:fund:${event.aggregateid}`, ...h.source }] : []
              break
            }
            case "inbox": result = draft.inbox.filter(row => row.organizationId === values[0] && row.consumerName === values[1]
              && row.consumerVersion === values[2] && row.eventId === values[3]); break
            case "occupied": result = draft.inbox.filter(row => row.consumerName === values[0] && row.consumerVersion === values[1]
              && row.sourceTopic === values[2] && row.sourcePartition === values[3] && row.sourceOffset === values[4]); break
            case "checkpoint": result = draft.checkpoint ? [draft.checkpoint] : []; break
            case "shadow": result = draft.shadow ? [draft.shadow] : []; break
            default: throw new Error(`Unexpected query ${label}`)
          }
          return structuredClone(result) as T
        },
        async $executeRawUnsafe(sql: string, ...values: unknown[]): Promise<number> {
          const label = call(sql, values)
          if (h.zeroAt === label) return 0
          switch (label) {
            case "insert-shadow":
            case "update-shadow":
              draft.shadow = { organizationId: values[0] as string, fundId: values[1] as string, projectionVersion: values[2] as number,
                buildKey: values[3] as string, status: "shadow", promotedAt: null, balance: values[4] as string, currency: values[5] as string,
                aggregateVersion: values[6] as string, lastEventId: values[7] as string, evidence: JSON.parse(values[8] as string) }
              break
            case "insert-inbox":
              draft.inbox.push({ organizationId: values[0] as string, consumerName: values[1] as string, consumerVersion: values[2] as number,
                eventId: values[3] as string, eventType: values[4] as string, payloadHash: values[5] as string, sourceTopic: values[6] as string,
                sourcePartition: values[7] as number, sourceOffset: values[8] as string, result: JSON.parse(values[9] as string) })
              break
            case "write-checkpoint": draft.checkpoint = { sourceOffset: values[4] as string, lastEventId: values[5] as string }; break
            default: throw new Error(`Unexpected mutation ${label}`)
          }
          return 1
        },
      }
      try {
        const result = await work(tx)
        await h.beforeCommit()
        if (h.commitFailure) throw new Error("injected deferred COMMIT failure")
        h.state = draft
        h.commits += 1
        return result
      } catch (error) { h.rollbacks += 1; throw error }
    },
  }
  return { h, db }
}

function writes(calls: Call[]): string[] { return calls.map(call => call.label).filter(label => /^(insert-|update-|write-)/.test(label)) }

describe("inactive Fund shadow consumer — mock control flow, not SQL/ACL proof", () => {
  it("folds and stores one fact, inbox and checkpoint through a single real-factory boundary", async () => {
    const { h, db } = harness()
    const result = await consumeFundShadowRecord(db, scope, record())
    expect(result).toMatchObject({ duplicate: false, state: { balance: "10.0000", aggregateVersion: 1 }, checkpointAdvanced: true,
      checkpoint: { sourceOffset: BigInt(0), lastEventId: fact().id } })
    expect(h.transactions).toBe(1)
    expect(h.commits).toBe(1)
    expect(h.options).toEqual({ isolationLevel: "Serializable", maxWait: 5000, timeout: 15000 })
    expect(writes(h.calls)).toEqual(["insert-shadow", "insert-inbox", "write-checkpoint"])
    expect(h.state.inbox[0].consumerName).toBe(`fund-shadow:${scope.buildId}`)
    expect(h.state.shadow).toMatchObject({ projectionVersion: 2, status: "shadow", promotedAt: null,
      evidence: { buildId: scope.buildId, codeSha: scope.codeSha, sourceTopic: "ld.test.finance.events.v1", sourcePartition: 0, lastSourceOffset: "0" } })
  })

  it("folds the exact next aggregate version without floating point money", async () => {
    const { h, db } = harness()
    await consumeFundShadowRecord(db, scope, record(1, 0, fact(1, { openingBalance: "900719925474.0992" })))
    const next = fact(2, { amount: "0.0001", signedDelta: "0.0001" })
    expect((await consumeFundShadowRecord(db, scope, record(2, 1, next))).state.balance).toBe("900719925474.0993")
    expect(h.state.inbox).toHaveLength(2)
  })

  it("returns the current shadow for an old duplicate, never its historical inbox result", async () => {
    const { h, db } = harness()
    await consumeFundShadowRecord(db, scope, record())
    await consumeFundShadowRecord(db, scope, record(2))
    const before = h.calls.length
    const duplicate = await consumeFundShadowRecord(db, scope, record())
    expect(duplicate).toMatchObject({ duplicate: true, state: { balance: "11.0000", aggregateVersion: 2 }, checkpointAdvanced: false,
      checkpoint: { sourceOffset: BigInt(1), lastEventId: fact(2).id } })
    expect((h.state.inbox[0].result as { balance: string }).balance).toBe("10.0000")
    expect(writes(h.calls.slice(before))).toEqual([])
  })

  it("advances only the checkpoint for a duplicate at a NEW offset, atomically", async () => {
    const { h, db } = harness()
    await consumeFundShadowRecord(db, scope, record())
    await consumeFundShadowRecord(db, scope, record(2))
    const before = h.calls.length
    const duplicate = await consumeFundShadowRecord(db, scope, record(1, 9))
    expect(duplicate).toMatchObject({ duplicate: true, state: { balance: "11.0000", aggregateVersion: 2 }, checkpointAdvanced: true,
      checkpoint: { sourceOffset: BigInt(9), lastEventId: fact().id } })
    expect(writes(h.calls.slice(before))).toEqual(["write-checkpoint"])
    expect(h.state.inbox).toHaveLength(2)
    expect(h.state.inbox[0].sourceOffset).toBe("0")
    expect(h.state.shadow?.evidence.lastSourceOffset).toBe("1")
  })

  it("does not rewind on same-offset or older duplicates after checkpoint-only advancement", async () => {
    const { h, db } = harness()
    await consumeFundShadowRecord(db, scope, record())
    await consumeFundShadowRecord(db, scope, record(1, 9))
    for (const sourceOffset of [9, 0, 5]) {
      const before = h.calls.length
      const result = await consumeFundShadowRecord(db, scope, record(1, sourceOffset))
      expect(result.checkpoint).toEqual({ sourceOffset: BigInt(9), lastEventId: fact().id })
      expect(result.checkpointAdvanced).toBe(false)
      expect(writes(h.calls.slice(before))).toEqual([])
    }
  })

  it.each([4, 5])("rejects unknown events at a passed offset %s", async sourceOffset => {
    const { h, db } = harness()
    await consumeFundShadowRecord(db, scope, record(1, 0))
    await consumeFundShadowRecord(db, scope, record(1, 5))
    const before = structuredClone(h.state)
    await expect(consumeFundShadowRecord(db, scope, record(2, sourceOffset))).rejects.toThrow(/Unknown event/)
    expect(h.state).toEqual(before)
  })

  it("rejects a known event occupying another event's original position", async () => {
    const { db } = harness()
    await consumeFundShadowRecord(db, scope, record())
    await consumeFundShadowRecord(db, scope, record(2))
    await expect(consumeFundShadowRecord(db, scope, record(1, 1))).rejects.toThrow(/Inbox identity/)
  })

  it("rejects delivery older than its ORIGINAL receipt even if a checkpoint is newer", async () => {
    const { db } = harness()
    await consumeFundShadowRecord(db, scope, record(1, 5))
    await consumeFundShadowRecord(db, scope, record(1, 9))
    await expect(consumeFundShadowRecord(db, scope, record(1, 4))).rejects.toThrow(/original inbox/)
  })

  it("rejects a same-offset duplicate when the checkpoint identifies another event", async () => {
    const { h, db } = harness()
    await consumeFundShadowRecord(db, scope, record())
    h.state.checkpoint = { sourceOffset: "9", lastEventId: fact(2).id }
    await expect(consumeFundShadowRecord(db, scope, record(1, 9))).rejects.toThrow(/Checkpoint position/)
  })

  it("rejects a receipt whose payload hash differs even when mocked source accepts the new hash", async () => {
    const { h, db } = harness()
    await consumeFundShadowRecord(db, scope, record())
    const changed = record(1, 3)
    changed.headers!.payloadhash = "b".repeat(64)
    h.source.payloadHash = h.source.incomingHash = h.source.sourceHash = "b".repeat(64)
    await expect(consumeFundShadowRecord(db, scope, changed)).rejects.toThrow(/Inbox identity/)
  })

  it.each(["payloadHash", "incomingHash", "sourceHash", "exactEnvelope", "parsedEnvelope", "topic", "partitionKey", "eventType"])(
    "fails closed on source proof mismatch %s", async field => {
      const { h, db } = harness()
      h.source[field] = field.endsWith("Envelope") ? false : "wrong"
      await expect(consumeFundShadowRecord(db, scope, record())).rejects.toThrow(/Full-envelope PostgreSQL/)
      expect(writes(h.calls)).toEqual([])
    },
  )

  it("rejects absent immutable outbox authority", async () => {
    const { h, db } = harness()
    h.sourcePresent = false
    await expect(consumeFundShadowRecord(db, scope, record())).rejects.toThrow(/Full-envelope PostgreSQL/)
  })

  it("binds raw text and parsed JSON separately to PG jsonb, never uses a JS hash/data-only hash", async () => {
    const { h, db } = harness()
    const input = record()
    input.value = Buffer.from(`\n ${input.value}\n`)
    await consumeFundShadowRecord(db, scope, input)
    const source = h.calls.find(call => call.label === "source")!
    expect(source.values[0]).toBe(input.value.toString("utf8"))
    expect(source.values[1]).toBe(JSON.stringify(fact()))
    expect(source.sql).toContain("event_platform_jsonb_sha256($1::jsonb)")
    expect(source.sql).toContain("event_platform_jsonb_sha256(envelope)")
    expect(source.sql).toContain("$1::jsonb = $2::jsonb")
    expect(source.sql).not.toContain("domain_events")
    expect(source.sql).not.toContain(fact().id)
  })

  it.each(["id", "eventtype", "organizationid", "payloadhash"])("requires one scalar %s header, not even a one-item array", async header => {
    const { h, db } = harness()
    const input = record()
    input.headers![header] = [input.headers![header] as string]
    await expect(consumeFundShadowRecord(db, scope, input)).rejects.toThrow(/single UTF-8/)
    expect(h.transactions).toBe(0)
  })

  it.each(["value", "key", "id"])("rejects malformed UTF-8 in %s before any database access", async field => {
    const { h, db } = harness()
    const input = record()
    const invalid = Buffer.from([0xc3, 0x28])
    if (field === "id") input.headers!.id = invalid
    else input[field as "key" | "value"] = invalid
    await expect(consumeFundShadowRecord(db, scope, input)).rejects.toThrow()
    expect(h.transactions).toBe(0)
  })

  it("rejects string surrogate corruption and header-id mismatch", async () => {
    const { h, db } = harness()
    const surrogate = record()
    surrogate.key = "tenant-a:fund:\ud800"
    await expect(consumeFundShadowRecord(db, scope, surrogate)).rejects.toThrow(/unpaired surrogate/)
    const mismatch = record()
    mismatch.headers!.id = fact(2).id
    await expect(consumeFundShadowRecord(db, scope, mismatch)).rejects.toThrow(/id header/)
    expect(h.transactions).toBe(0)
  })

  it.each(["ld.test.sales.events.v1", "ld.prod.finance.events.v1"])("rejects nonconfigured finance topic %s", async topic => {
    const { h, db } = harness()
    await expect(consumeFundShadowRecord(db, scope, { ...record(), topic })).rejects.toThrow(/exact finance topic/)
    expect(h.transactions).toBe(0)
  })

  it.each([
    { organizationid: "tenant-b" }, { aggregatetype: "other" }, { classification: "public" },
    { dataschema: "urn:wrong" }, { time: "2026-02-31T00:00:00Z" }, { id: "not-a-uuid" },
    { type: "finance.some-other-event.v1" },
  ])("rejects malformed/unrelated contract before tx: %o", async overrides => {
    const { h, db } = harness()
    const event = { ...fact(), ...overrides } as DomainEventEnvelope
    await expect(consumeFundShadowRecord(db, scope, record(1, 0, event))).rejects.toThrow()
    expect(h.transactions).toBe(0)
  })

  it.each(["-1", "01", "1.5", "9223372036854775808"])("rejects nonrepresentable broker offset %s", async value => {
    const { h, db } = harness()
    await expect(consumeFundShadowRecord(db, scope, { ...record(), offset: value })).rejects.toThrow()
    expect(h.transactions).toBe(0)
  })

  it.each([{ projectionVersion: 1 }, { projectionVersion: 2.5 }, { buildId: "bad" }, { codeSha: "bad" }, { expectedWorkerRole: "role; GRANT" }])(
    "rejects unsafe trusted scope %o", async overrides => {
      const { h, db } = harness()
      await expect(consumeFundShadowRecord(db, { ...scope, ...overrides }, record())).rejects.toThrow()
      expect(h.transactions).toBe(0)
    },
  )

  it.each([{ currentRole: "app_owner" }, { sessionRole: "postgres" }, { restricted: false }])("rejects incorrect login/role attributes %o", async overrides => {
    const { h, db } = harness()
    Object.assign(h.role, overrides)
    await expect(consumeFundShadowRecord(db, scope, record())).rejects.toThrow(/restricted login/)
    expect(h.calls.map(call => call.label)).toEqual(["role"])
  })

  it.each([
    ["organizationId", "tenant-b"], ["projectionName", "other"], ["projectionVersion", 1], ["buildKey", "other"], ["codeSha", "d".repeat(40)],
    ["id", "70000000-0000-4000-8000-000000000002"], ["mode", "live"], ["status", "ready"], ["status", "verifying"], ["effectsFenced", false],
    ["replayFrom", "2026-01-01"], ["replayTo", "2026-02-01"],
  ])("rejects locked build mismatch %s=%s", async (field, value) => {
    const { h, db } = harness()
    h.build[field as string] = value
    await expect(consumeFundShadowRecord(db, scope, record())).rejects.toThrow(/Build identity|Ranged builds/)
    expect(writes(h.calls)).toEqual([])
    expect(h.calls.find(call => call.label === "build")?.sql).toContain("FOR UPDATE")
  })

  it.each(["sourceTopic", "sourcePartition", "buildId", "codeSha"])("rejects aggregate shadow evidence drift: %s", async field => {
    const { h, db } = harness()
    await consumeFundShadowRecord(db, scope, record())
    h.state.shadow!.evidence[field] = field === "sourcePartition" ? 9 : "wrong"
    await expect(consumeFundShadowRecord(db, scope, record(2))).rejects.toThrow(/binding mismatch/)
  })

  it("rejects active/retired shadow substitution without touching v1 or pointers", async () => {
    const { h, db } = harness()
    await consumeFundShadowRecord(db, scope, record())
    h.state.shadow!.status = "active"
    const before = h.calls.length
    await expect(consumeFundShadowRecord(db, scope, record(2))).rejects.toThrow(/untouched shadow/)
    expect(writes(h.calls.slice(before))).toEqual([])
    expect(h.calls.some(call => /UPDATE\s+(?:public\.)?(?:funds|domain_events|effect_outbox|projection_pointers)\b/i.test(call.sql))).toBe(false)
  })

  it("rejects missing shadow or checkpoint evidence for an already processed event", async () => {
    const { h, db } = harness()
    await consumeFundShadowRecord(db, scope, record())
    const state = structuredClone(h.state)
    h.state.shadow = null
    await expect(consumeFundShadowRecord(db, scope, record())).rejects.toThrow(/no coherent current shadow/)
    h.state = state
    h.state.checkpoint = null
    await expect(consumeFundShadowRecord(db, scope, record())).rejects.toThrow(/ahead of its checkpoint/)
  })

  it("rejects future shadow evidence and version gaps instead of skipping facts", async () => {
    const { h, db } = harness()
    await consumeFundShadowRecord(db, scope, record())
    h.state.shadow!.evidence.lastSourceOffset = "2"
    await expect(consumeFundShadowRecord(db, scope, record(2))).rejects.toThrow(/ahead of its checkpoint/)
    h.state.shadow!.evidence.lastSourceOffset = "0"
    await expect(consumeFundShadowRecord(db, scope, record(3, 2))).rejects.toThrow(/exact successor/)
  })

  it.each(["insert-shadow", "insert-inbox", "write-checkpoint"])("propagates %s failure so the transaction factory can roll back all writes", async label => {
    const { h, db } = harness()
    h.failAt = label
    await expect(consumeFundShadowRecord(db, scope, record())).rejects.toThrow(/injected/)
    expect(h.state).toEqual({ inbox: [], shadow: null, checkpoint: null })
    expect(h.rollbacks).toBe(1)
    expect(h.commits).toBe(0)
  })

  it.each(["insert-shadow", "insert-inbox", "write-checkpoint"])("fails closed on zero-row %s mutation", async label => {
    const { h, db } = harness()
    h.zeroAt = label
    await expect(consumeFundShadowRecord(db, scope, record())).rejects.toThrow()
    expect(h.state).toEqual({ inbox: [], shadow: null, checkpoint: null })
  })

  it("does not acknowledge/resolve before the factory finishes COMMIT", async () => {
    const { h, db } = harness()
    let releaseCommit!: () => void
    let enteredCommit!: () => void
    const entered = new Promise<void>(resolve => { enteredCommit = resolve })
    const release = new Promise<void>(resolve => { releaseCommit = resolve })
    h.beforeCommit = async () => { enteredCommit(); await release }
    let resolved = false
    const result = consumeFundShadowRecord(db, scope, record()).then(value => { resolved = true; return value })
    await entered
    expect(resolved).toBe(false)
    expect(h.state.shadow).toBeNull()
    releaseCommit()
    await result
    expect(resolved).toBe(true)
    expect(h.commits).toBe(1)
  })

  it("propagates a deferred COMMIT error instead of returning a successful projection", async () => {
    const { h, db } = harness()
    h.commitFailure = true
    await expect(consumeFundShadowRecord(db, scope, record())).rejects.toThrow(/deferred COMMIT/)
    expect(h.state).toEqual({ inbox: [], shadow: null, checkpoint: null })
  })

  it("does not advance a duplicate checkpoint when its transaction fails", async () => {
    const { h, db } = harness()
    await consumeFundShadowRecord(db, scope, record())
    const before = structuredClone(h.state)
    h.failAt = "write-checkpoint"
    await expect(consumeFundShadowRecord(db, scope, record(1, 5))).rejects.toThrow(/injected/)
    expect(h.state).toEqual(before)
  })
})
