import { beforeEach, describe, expect, it, vi } from "vitest"
import type { KafkaEventRecord } from "../lib/event-platform/consumer"
import type { DomainEventEnvelope } from "../lib/event-platform/envelope"
import { consumeFundShadowRecord, type FundShadowDatabase, type FundShadowResult, type FundShadowScope, type FundShadowTransaction } from "../lib/event-platform/fund-shadow-consumer"
import { createFundShadowPartitionWorker } from "../lib/event-platform/fund-shadow-worker"
import type { PartitionAssignment } from "../lib/event-platform/partition-processor"

vi.mock("../lib/event-platform/fund-shadow-consumer", async importOriginal => {
  const original = await importOriginal<typeof import("../lib/event-platform/fund-shadow-consumer")>()
  return { ...original, consumeFundShadowRecord: vi.fn() }
})

const consume = vi.mocked(consumeFundShadowRecord)
const TOPIC = "ld.test.finance.events.v1"
const HASH = "a".repeat(64) // Transport fixture only, not a JS replacement for PG-jsonb hashing.

function gate() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}

function assignment(): PartitionAssignment {
  return { clusterId: "synthetic-cluster", groupId: "synthetic-build-plan", memberId: "original-member",
    generationId: 3, topic: TOPIC, partition: 0, nextOffset: "0" }
}

function route(suffix: "a" | "b" = "a") {
  const scope = { organizationId: `tenant-${suffix}`, buildId: `70000000-0000-4000-8000-00000000000${suffix === "a" ? "1" : "2"}`,
    buildKey: `shadow-${suffix}`, projectionVersion: 2, codeSha: "c".repeat(40), environment: "test", expectedWorkerRole: `fund_shadow_${suffix}` } satisfies FundShadowScope
  const transactionCalls = vi.fn()
  const tx: FundShadowTransaction = {
    async $queryRawUnsafe<T>(): Promise<T> { throw new Error("Unit fixture must not execute SQL") },
    async $executeRawUnsafe(): Promise<number> { throw new Error("Unit fixture must not execute SQL") },
  }
  const database: FundShadowDatabase = {
    async $transaction<T>(work: (tx: FundShadowTransaction) => Promise<T>, options: { isolationLevel: "Serializable"; maxWait: number; timeout: number }): Promise<T> {
      transactionCalls(this, options)
      return work(tx)
    },
  }
  return { scope, database, transactionCalls }
}

function record(tenant = "tenant-a", position = "0", version = 1): KafkaEventRecord {
  const envelope: DomainEventEnvelope = {
    specversion: "1.0", datacontenttype: "application/json", id: `10000000-0000-4000-8000-${String(version).padStart(12, "0")}`,
    source: "urn:leaddrive:finance", type: "finance.fund-opened.v1", time: "2026-10-18T00:00:00.000Z",
    dataschema: "urn:leaddrive:schema:finance.fund-opened:v1", organizationid: tenant, aggregatetype: "fund", aggregateid: `fund-${tenant}`,
    aggregateversion: version, correlationid: "synthetic-command", producer: "synthetic-test", producerversion: "v1", classification: "confidential",
    data: { fundId: `fund-${tenant}`, currency: "USD", openingBalance: "10.0000" },
  }
  return { topic: TOPIC, partition: 0, offset: position, key: `${tenant}:fund:${envelope.aggregateid}`, value: JSON.stringify(envelope),
    headers: { id: envelope.id, eventtype: envelope.type, organizationid: tenant, payloadhash: HASH } }
}

function result(incoming: KafkaEventRecord, duplicate = false): FundShadowResult {
  const envelope = JSON.parse(String(incoming.value)) as DomainEventEnvelope
  return { duplicate, state: { organizationId: envelope.organizationid, fundId: envelope.aggregateid, balance: "10.0000", currency: "USD",
    aggregateVersion: envelope.aggregateversion, lastEventId: envelope.id, lastEventAt: envelope.time },
  checkpointAdvanced: !duplicate, checkpoint: { sourceOffset: BigInt(incoming.offset), lastEventId: envelope.id } }
}

function harness(routes = [route()]) {
  const commit = vi.fn(async (_assignment: Readonly<PartitionAssignment>, _next: string) => {})
  const worker = createFundShadowPartitionWorker({ assignment: assignment(), environment: "test", routes,
    broker: { isCurrent: () => true, commitNextOffset: commit } })
  return { worker, commit, routes }
}

beforeEach(() => {
  consume.mockReset()
  consume.mockImplementation(async (_database, _scope, incoming) => result(incoming))
})

// The SQL adapter is mocked except explicit pre-transaction validation cases.
// These tests prove routing/control flow, not SQL, RLS, Kafka or durable COMMIT.
describe("inactive Fund shadow partition worker", () => {
  it("routes A/B/A through independently configured scopes in partition order", async () => {
    const a = route("a")
    const b = route("b")
    const h = harness([a, b])
    await h.worker.processBatch({ fetchOffset: "0", records: [record(), record("tenant-b", "1"), record("tenant-a", "2", 2)] })
    expect(consume.mock.calls.map(([, scope, incoming]) => [scope.organizationId, scope.buildId, scope.expectedWorkerRole, incoming.offset])).toEqual([
      ["tenant-a", a.scope.buildId, "fund_shadow_a", "0"], ["tenant-b", b.scope.buildId, "fund_shadow_b", "1"], ["tenant-a", a.scope.buildId, "fund_shadow_a", "2"],
    ])
    expect(h.commit.mock.calls.map(([, next]) => next)).toEqual(["1", "2", "3"])
    expect(a.transactionCalls).not.toHaveBeenCalled()
    expect(b.transactionCalls).not.toHaveBeenCalled() // The wrapper never adds an outer transaction.
  })

  it("does not acknowledge or visit another tenant until the adapter resolves its COMMIT boundary", async () => {
    const waiting = gate()
    consume.mockImplementationOnce(async (_database, _scope, incoming) => { await waiting.promise; return result(incoming) })
    const h = harness([route("a"), route("b")])
    const pending = h.worker.processBatch({ fetchOffset: "0", records: [record(), record("tenant-b", "1")] })
    expect(consume).toHaveBeenCalledTimes(1)
    expect(h.commit).not.toHaveBeenCalled()
    waiting.release()
    await pending
    expect(consume).toHaveBeenCalledTimes(2)
    expect(h.commit.mock.calls.map(([, next]) => next)).toEqual(["1", "2"])
  })

  it("halts on an adapter COMMIT failure without acknowledging the failed or later record", async () => {
    const failure = new Error("adapter deferred COMMIT failure")
    consume.mockRejectedValueOnce(failure)
    const h = harness([route("a"), route("b")])
    await expect(h.worker.processBatch({ fetchOffset: "0", records: [record(), record("tenant-b", "1")] })).rejects.toBe(failure)
    expect(consume).toHaveBeenCalledTimes(1)
    expect(h.commit).not.toHaveBeenCalled()
    expect(h.worker.status().state).toBe("stopped")
  })

  it("never uses a duplicate's historical/current tenant checkpoint as the Kafka cursor", async () => {
    consume.mockImplementationOnce(async (_database, _scope, incoming) => ({ ...result(incoming, true), checkpoint: { sourceOffset: BigInt(900), lastEventId: "newer-tenant-fact" } }))
    const h = harness()
    await h.worker.processBatch({ fetchOffset: "0", records: [record()] })
    expect(h.commit.mock.calls[0][1]).toBe("1")
    expect(h.worker.status().nextOffset).toBe("1")
  })

  it("cannot acknowledge an unknown tenant or silently skip it to a later allowed record", async () => {
    const h = harness()
    await expect(h.worker.processBatch({ fetchOffset: "0", records: [record("tenant-unadmitted"), record("tenant-a", "1")] })).rejects.toThrow("outside the worker admission plan")
    expect(consume).not.toHaveBeenCalled()
    expect(h.commit).not.toHaveBeenCalled()
    expect(h.worker.status().state).toBe("stopped")
  })

  it("rejects conflicting tenant headers and keys before selecting a database", async () => {
    const h = harness([route("a"), route("b")])
    const incoming = record()
    incoming.headers!.organizationid = "tenant-b"
    incoming.key = "tenant-b:fund:fund-tenant-a"
    await expect(h.worker.processBatch({ fetchOffset: "0", records: [incoming] })).rejects.toThrow()
    expect(consume).not.toHaveBeenCalled()
    expect(h.commit).not.toHaveBeenCalled()
  })

  it.each(["unknown type", "unknown schema"])("delegates %s to the actual Fund contract guard, before any SQL", async kind => {
    const actual = await vi.importActual<typeof import("../lib/event-platform/fund-shadow-consumer")>("../lib/event-platform/fund-shadow-consumer")
    consume.mockImplementationOnce(actual.consumeFundShadowRecord)
    const a = route()
    const h = harness([a])
    const incoming = record()
    const envelope = JSON.parse(String(incoming.value)) as DomainEventEnvelope
    if (kind === "unknown type") {
      envelope.type = "finance.unapproved.v1"
      incoming.headers!.eventtype = envelope.type
    } else envelope.dataschema = "urn:leaddrive:schema:finance.fund-opened:v99"
    incoming.value = JSON.stringify(envelope)
    await expect(h.worker.processBatch({ fetchOffset: "0", records: [incoming] })).rejects.toThrow()
    expect(a.transactionCalls).not.toHaveBeenCalled()
    expect(h.commit).not.toHaveBeenCalled()
    expect(h.worker.status().state).toBe("stopped")
  })

  it("captures immutable scopes, the route list and original bound transaction factories", async () => {
    const a = route("a")
    const routes = [a]
    const configured = { ...assignment() }
    const commit = vi.fn(async (_assignment: Readonly<PartitionAssignment>, _next: string) => {})
    const worker = createFundShadowPartitionWorker({ assignment: configured, environment: "test", routes,
      broker: { isCurrent: () => true, commitNextOffset: commit } })
    const expectedScope = { ...a.scope }
    const replacementFactory = vi.fn(async () => { throw new Error("replaced factory must not run") })
    a.database.$transaction = replacementFactory
    a.scope.organizationId = "tenant-forged"
    a.scope.expectedWorkerRole = "privileged"
    a.scope.codeSha = "d".repeat(40)
    a.scope.buildKey = "different-build"
    routes.splice(0, 1, route("b"))
    configured.memberId = "replacement-member"
    configured.generationId = 99
    consume.mockImplementationOnce(async (database, scope, incoming) => {
      expect(scope).toEqual(expectedScope)
      expect(Object.isFrozen(scope)).toBe(true)
      return database.$transaction(async () => result(incoming), { isolationLevel: "Serializable", maxWait: 5000, timeout: 15000 })
    })
    await worker.processBatch({ fetchOffset: "0", records: [record()] })
    expect(replacementFactory).not.toHaveBeenCalled()
    expect(a.transactionCalls).toHaveBeenCalledTimes(1)
    expect(a.transactionCalls.mock.calls[0][0]).toBe(a.database)
    expect(commit.mock.calls[0][0]).toMatchObject({ memberId: "original-member", generationId: 3 })
  })

  it("snapshots binary tenant identity and payload before an in-flight earlier tenant completes", async () => {
    const waiting = gate()
    consume.mockImplementationOnce(async (_database, _scope, incoming) => { await waiting.promise; return result(incoming) })
    const h = harness([route("a"), route("b")])
    const original = record("tenant-b", "1")
    const binary: KafkaEventRecord = { ...original, key: Buffer.from(String(original.key)), value: Buffer.from(String(original.value)),
      headers: Object.fromEntries(Object.entries(original.headers!).map(([name, value]) => [name, Buffer.from(String(value))])) }
    const pending = h.worker.processBatch({ fetchOffset: "0", records: [record(), binary] })
    ;(binary.value as Buffer).fill(0)
    ;(binary.key as Buffer).fill(0)
    ;(binary.headers!.organizationid as Buffer).fill(0)
    binary.offset = "500"
    waiting.release()
    await pending
    const [, selected, received] = consume.mock.calls[1]
    expect(selected.organizationId).toBe("tenant-b")
    expect(String(received.value)).toBe(original.value)
    expect(String(received.key)).toBe(original.key)
    expect(received.offset).toBe("1")
    expect(h.commit.mock.calls.map(([, next]) => next)).toEqual(["1", "2"])
  })

  it("does not ack an adapter result that completes after revocation", async () => {
    const waiting = gate()
    consume.mockImplementationOnce(async (_database, _scope, incoming) => { await waiting.promise; return result(incoming) })
    const h = harness()
    const pending = h.worker.processBatch({ fetchOffset: "0", records: [record()] })
    h.worker.revoke()
    const rejected = expect(pending).rejects.toMatchObject({ code: "ASSIGNMENT_REVOKED" })
    waiting.release()
    await rejected
    expect(h.commit).not.toHaveBeenCalled()
    expect(h.worker.status().state).toBe("revoked")
  })

  it.each(["tenant", "role", "build", "environment"])("rejects conflicting admission %s identities", conflict => {
    const a = route("a")
    const b = route("b")
    if (conflict === "tenant") b.scope.organizationId = a.scope.organizationId
    if (conflict === "role") b.scope.expectedWorkerRole = a.scope.expectedWorkerRole
    if (conflict === "build") b.scope.buildId = a.scope.buildId.toUpperCase()
    if (conflict === "environment") b.scope.environment = "prod"
    expect(() => harness([a, b])).toThrow("unique and environment-bound")
    expect(consume).not.toHaveBeenCalled()
  })

  it("requires a nonempty bounded admission plan and its exact finance topic", () => {
    expect(() => harness([])).toThrow("bounded tenant admission plan")
    expect(() => harness(Array.from({ length: 1001 }, () => route()))).toThrow("bounded tenant admission plan")
    expect(() => createFundShadowPartitionWorker({ assignment: { ...assignment(), topic: "ld.test.other.events.v1" }, environment: "test", routes: [route()],
      broker: { isCurrent: () => true, commitNextOffset: async () => {} } })).toThrow("configured finance topic")
    expect(consume).not.toHaveBeenCalled()
  })

  it("passes batch limits through without applying partially admitted work", async () => {
    const commit = vi.fn(async () => {})
    const worker = createFundShadowPartitionWorker({ assignment: assignment(), environment: "test", routes: [route()],
      maxBatchRecords: 1, broker: { isCurrent: () => true, commitNextOffset: commit } })
    await expect(worker.processBatch({ fetchOffset: "0", records: [record(), record("tenant-a", "1")] })).rejects.toMatchObject({ code: "INVALID_DELIVERY" })
    expect(consume).not.toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
  })
})
