import { describe, expect, it } from "vitest"
import type { DomainEventEnvelope } from "../lib/event-platform/envelope"
import type { CanonicalJsonValue } from "../lib/event-platform/canonical-json"
import { EventContractValidationError, FUND_EVENT_CONTRACTS } from "../lib/event-platform/fund-contracts"
import { FundBalanceReductionError, reduceFundBalance, type FundBalanceState } from "../lib/event-platform/fund-balance-reducer"

const schemas = {
  "finance.fund-opened.v1": "urn:leaddrive:schema:finance.fund-opened:v1",
  "finance.fund-transaction-recorded.v1": "urn:leaddrive:schema:finance.fund-transaction-recorded:v1",
  "finance.fund-metadata-updated.v1": "urn:leaddrive:schema:finance.fund-metadata-updated:v1",
  "finance.fund-archived.v1": "urn:leaddrive:schema:finance.fund-archived:v1",
  "finance.fund-reactivated.v1": "urn:leaddrive:schema:finance.fund-reactivated:v1",
} as const
type FundType = keyof typeof schemas
type Data = Record<string, CanonicalJsonValue>

function fact(type: FundType, version: number, data: Data, overrides: Partial<DomainEventEnvelope> = {}): DomainEventEnvelope {
  return {
    specversion: "1.0", datacontenttype: "application/json",
    id: `10000000-0000-4000-8000-${String(version).padStart(12, "0")}`,
    source: "urn:leaddrive:finance", type, dataschema: schemas[type],
    organizationid: "tenant-a", aggregatetype: "fund", aggregateid: "fund-a", aggregateversion: version,
    time: "2026-10-17T12:00:00.000Z", correlationid: "fixture-command",
    producer: "fund-reducer-test", producerversion: "fixture-v1", classification: "confidential",
    data, ...overrides,
  }
}

function opening(balance = "10.0000", data: Data = {}): DomainEventEnvelope {
  return fact("finance.fund-opened.v1", 1, { fundId: "fund-a", currency: "USD", openingBalance: balance, ...data })
}

function transaction(version = 2, type = "deposit", amount = "1.0000", delta = "1.0000", data: Data = {}): DomainEventEnvelope {
  return fact("finance.fund-transaction-recorded.v1", version, {
    fundId: "fund-a", transactionId: `transaction-${version}`, transactionType: type,
    amount, signedDelta: delta, currency: "USD", ...data,
  })
}

function metadata(version: number, data: Data = {}): DomainEventEnvelope {
  return fact("finance.fund-metadata-updated.v1", version, {
    fundId: "fund-a", changedFields: ["name"], name: "Updated Fund", currency: "USD", isActive: true, ...data,
  })
}

function archived(version: number, data: Data = {}): DomainEventEnvelope {
  return fact("finance.fund-archived.v1", version, { fundId: "fund-a", reason: "historical archive", ...data })
}

function reactivated(version: number, data: Data = {}): DomainEventEnvelope {
  return fact("finance.fund-reactivated.v1", version, {
    fundId: "fund-a", changedFields: ["isActive"], name: "Reactivated Fund", currency: "USD", isActive: true, ...data,
  })
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

describe("pure Fund balance reducer", () => {
  it("folds all five event kinds and transaction signs against independent exact golden balances", () => {
    const events = [
      opening("10.0001"),
      transaction(2, "deposit", "1.2345", "1.2345", { resultingBalance: "11.2346" }),
      transaction(3, "withdrawal", "0.0006", "-0.0006"),
      transaction(4, "transfer_in", "2.0000", "2.0000"),
      transaction(5, "transfer_out", "3.2340", "-3.2340"),
      transaction(6, "auto_allocation", "0.9999", "0.9999"),
      metadata(7, { targetAmount: "1.0000", description: null, color: null }),
      archived(8), reactivated(9),
    ]
    const expected = ["10.0001", "11.2346", "11.2340", "13.2340", "10.0000", "10.9999", "10.9999", "10.9999", "10.9999"]
    let state: FundBalanceState | null = null
    for (const [index, event] of events.entries()) {
      state = reduceFundBalance(state, event)
      expect(state).toEqual({
        organizationId: "tenant-a", fundId: "fund-a", currency: "USD", balance: expected[index],
        aggregateVersion: index + 1, lastEventId: event.id, lastEventAt: event.time,
      })
    }
  })

  it("preserves the smallest quantum, exact zero and amounts above Number's scaled safe-integer limit", () => {
    const zero = reduceFundBalance(null, opening("0.0000"))
    const cent = reduceFundBalance(zero, transaction(2, "deposit", "0.0001", "0.0001"))
    expect(cent.balance).toBe("0.0001")
    expect(reduceFundBalance(cent, transaction(3, "withdrawal", "0.0001", "-0.0001")).balance).toBe("0.0000")
    const large = reduceFundBalance(null, opening("900719925474.0992"))
    expect(reduceFundBalance(large, transaction(2, "deposit", "0.0001", "0.0001")).balance).toBe("900719925474.0993")
  })

  it("accepts the exact NUMERIC(18,4) maximum and subtracts it without rounding", () => {
    const almost = reduceFundBalance(null, opening("99999999999999.9998"))
    const maximum = reduceFundBalance(almost, transaction(2, "deposit", "0.0001", "0.0001"))
    expect(maximum.balance).toBe("99999999999999.9999")
    expect(reduceFundBalance(maximum, transaction(3, "withdrawal", "99999999999999.9999", "-99999999999999.9999")).balance).toBe("0.0000")
  })

  it("rejects a one-quantum signed-delta mismatch above safe-integer precision at the contract boundary", () => {
    const schema = FUND_EVENT_CONTRACTS["finance.fund-transaction-recorded.v1"].data
    const data = {
      fundId: "fund-a", transactionId: "large-withdrawal", currency: "USD",
      transactionType: "withdrawal", amount: "900719925474.0993", signedDelta: "-900719925474.0993",
    }
    expect(schema.safeParse(data).success).toBe(true)
    expect(schema.safeParse({ ...data, signedDelta: "-900719925474.0992" }).success).toBe(false)
  })

  it("checks a negative legacy total exactly before the reducer sees the bootstrap fact", () => {
    const schema = FUND_EVENT_CONTRACTS["finance.fund-opened.v1"].data
    const data = {
      fundId: "fund-a", currency: "USD", legacyBootstrap: true, legacyTransactionCount: 1,
      openingBalance: "900719925474.0993", signedLegacyTransactionTotal: "-900719925474.0992",
      storedBalance: "0.0001",
    }
    expect(schema.safeParse(data).success).toBe(true)
    expect(schema.safeParse({ ...data, storedBalance: "0.0000" }).success).toBe(false)
  })

  it("rejects overflow and negative prefixes immediately, even if a later fact could conceal them", () => {
    const maximum = reduceFundBalance(null, opening("99999999999999.9999"))
    expect(() => reduceFundBalance(maximum, transaction(2, "deposit", "0.0001", "0.0001"))).toThrow(/outside/)
    const state = reduceFundBalance(null, opening("10.0000"))
    expect(() => reduceFundBalance(state, transaction(2, "withdrawal", "10.0001", "-10.0001"))).toThrow(/outside/)
    expect(state.balance).toBe("10.0000")
    expect(state.aggregateVersion).toBe(1)
    expect(() => reduceFundBalance(state, transaction(3, "deposit", "1.0000", "1.0000"))).toThrow(/exact successor/)
  })

  it.each(["-0.0001", "-0.0000", "100000000000000.0000", "1", "1.0", "1.00000", "01.0000", "+1.0000", "1e3", "NaN", "Infinity", 1, null])(
    "rejects malformed/nonrepresentable opening money %s", value => {
      expect(() => reduceFundBalance(null, opening("0.0000", { openingBalance: value }))).toThrow(EventContractValidationError)
    },
  )

  it.each([
    ["deposit", "-1.0000"], ["transfer_in", "-1.0000"], ["auto_allocation", "-1.0000"],
    ["withdrawal", "1.0000"], ["transfer_out", "1.0000"],
  ])("rejects %s with a contradictory signed delta", (type, delta) => {
    expect(() => reduceFundBalance(reduceFundBalance(null, opening()), transaction(2, type, "1.0000", delta))).toThrow(EventContractValidationError)
  })

  it.each(["0.0000", "-1.0000", "1.00001", 1])("rejects invalid ledger amount %s", amount => {
    expect(() => reduceFundBalance(reduceFundBalance(null, opening()), transaction(2, "deposit", "1.0000", "1.0000", { amount }))).toThrow(EventContractValidationError)
  })

  it("uses resultingBalance only as an assertion, never as balance authority", () => {
    const state = reduceFundBalance(null, opening())
    expect(reduceFundBalance(state, transaction(2, "deposit", "1.0000", "1.0000", { resultingBalance: "11.0000" })).balance).toBe("11.0000")
    expect(() => reduceFundBalance(state, transaction(2, "deposit", "1.0000", "1.0000", { resultingBalance: "900.0000" }))).toThrow(/independently reduced/)
    expect(reduceFundBalance(state, transaction()).balance).toBe("11.0000")
  })

  it("replays copied historical ledger facts after an inactive legacy opening", () => {
    const legacy = opening("85.0000", {
      legacyBootstrap: true, storedBalance: "98.0000", signedLegacyTransactionTotal: "13.0000",
      legacyTransactionCount: 2, isActive: false,
    })
    const first = reduceFundBalance(null, legacy)
    expect(first.balance).toBe("85.0000") // Not the stored final 98.0000.
    const second = reduceFundBalance(first, transaction(2, "deposit", "45.0000", "45.0000", { legacyBootstrap: true }))
    expect(second.balance).toBe("130.0000")
    expect(reduceFundBalance(second, transaction(3, "withdrawal", "32.0000", "-32.0000", { legacyBootstrap: true })).balance).toBe("98.0000")
    expect(first).not.toHaveProperty("isActive")
  })

  it("does not turn archive state into a command-eligibility check during historical reduction", () => {
    const state = reduceFundBalance(reduceFundBalance(null, opening()), archived(2))
    expect(reduceFundBalance(state, transaction(3, "deposit", "1.0000", "1.0000")).balance).toBe("11.0000")
  })

  it("requires exactly one opening at v1 and rejects gaps, reordering and unfiltered duplicate delivery", () => {
    expect(() => reduceFundBalance(null, transaction())).toThrow(/begin/)
    expect(() => reduceFundBalance(null, { ...opening(), aggregateversion: 2 })).toThrow(/begin/)
    const first = reduceFundBalance(null, opening())
    expect(() => reduceFundBalance(first, { ...opening(), aggregateversion: 2 })).toThrow(/only one opening/)
    expect(() => reduceFundBalance(first, transaction(3))).toThrow(/exact successor/)
    const second = reduceFundBalance(first, transaction())
    expect(() => reduceFundBalance(second, transaction())).toThrow(/exact successor/)
    expect(() => reduceFundBalance(second, transaction(1))).toThrow(/exact successor/)
    expect(() => reduceFundBalance(first, { ...transaction(), id: first.lastEventId })).toThrow(/reuse/)
  })

  it("rejects a tenant or Fund switch even when payload identity is internally consistent", () => {
    const first = reduceFundBalance(null, opening())
    expect(() => reduceFundBalance(first, { ...transaction(), organizationid: "tenant-b" })).toThrow(/previous tenant\/Fund/)
    expect(() => reduceFundBalance(first, { ...transaction(2, "deposit", "1.0000", "1.0000", { fundId: "fund-b" }), aggregateid: "fund-b" })).toThrow(/previous tenant\/Fund/)
    expect(() => reduceFundBalance(first, transaction(2, "deposit", "1.0000", "1.0000", { fundId: "fund-b" }))).toThrow(EventContractValidationError)
  })

  it("keeps currency immutable for money and every metadata event which supplies it", () => {
    const first = reduceFundBalance(null, opening())
    for (const event of [transaction(2, "deposit", "1.0000", "1.0000", { currency: "EUR" }), metadata(2, { currency: "EUR" }), archived(2, { currency: "EUR" }), reactivated(2, { currency: "EUR" })]) {
      expect(() => reduceFundBalance(first, event)).toThrow(/currency is immutable/)
    }
    expect(reduceFundBalance(first, archived(2)).currency).toBe("USD")
  })

  it("rejects malformed exact contracts rather than accepting other domains or a permissive fallback", () => {
    const first = reduceFundBalance(null, opening())
    for (const event of [
      { ...transaction(), type: "finance.fund-unknown.v1" },
      { ...transaction(), type: "crm.contact-created.v1", aggregatetype: "contact" },
      { ...transaction(), type: "toString" },
      { ...transaction(), dataschema: schemas["finance.fund-opened.v1"] },
      { ...transaction(), aggregatetype: "account" },
      { ...transaction(), classification: "internal" as const },
      metadata(2, { changedFields: [] }), metadata(2, { changedFields: ["name", "name"] }),
      transaction(2, "deposit", "1.0000", "1.0000", { unknownPayloadField: true }),
      reactivated(2, { isActive: false }),
      archived(2, { reason: "", isActive: true }),
    ]) expect(() => reduceFundBalance(first, event)).toThrow()
    expect(() => reduceFundBalance(null, opening("10.0000", { legacyBootstrap: true }))).toThrow(EventContractValidationError)
  })

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, "1"])("rejects an unsafe aggregate version %s", version => {
    expect(() => reduceFundBalance(null, { ...opening(), aggregateversion: version } as DomainEventEnvelope)).toThrow(/positive safe integer/)
  })

  it("rejects malformed identity/envelope boundaries before returning state", () => {
    for (const identity of ["", "tenant:other", "tenant other", "tenant\0other", "a".repeat(192)]) {
      expect(() => reduceFundBalance(null, { ...opening(), organizationid: identity })).toThrow(/identity/)
      expect(() => reduceFundBalance(null, { ...opening(), aggregateid: identity })).toThrow(/identity/)
    }
    expect(() => reduceFundBalance(null, { ...opening(), id: "not-a-uuid" })).toThrow(/UUID/)
    expect(() => reduceFundBalance(null, { ...opening(), specversion: "2.0" } as unknown as DomainEventEnvelope)).toThrow(/envelope/)
    expect(() => reduceFundBalance(null, { ...opening(), datacontenttype: "text/plain" } as unknown as DomainEventEnvelope)).toThrow(/envelope/)
    expect(() => reduceFundBalance(null, null as unknown as DomainEventEnvelope)).toThrow(/object/)
    expect(() => reduceFundBalance(null, { ...opening(), data: null } as unknown as DomainEventEnvelope)).toThrow(EventContractValidationError)
  })

  it("preserves historical occurrence time without imposing time order or consulting the wall clock", () => {
    const first = reduceFundBalance(null, opening())
    const older = { ...transaction(), time: "2020-02-29T00:00:00.123456Z" }
    expect(reduceFundBalance(first, older).lastEventAt).toBe("2020-02-29T00:00:00.123456Z")
    for (const time of ["not-a-date", "2026-02-30T00:00:00.000Z", "2026-10-17", "2026-10-17T25:00:00Z"]) {
      expect(() => reduceFundBalance(first, { ...transaction(), time })).toThrow(/timestamp/)
    }
  })

  it("rejects corrupted prior state instead of rounding or propagating its fields", () => {
    const first = reduceFundBalance(null, opening())
    for (const patch of [
      { balance: "1.0" }, { balance: "-0.0001" }, { balance: "100000000000000.0000" },
      { currency: "usd" }, { organizationId: "" }, { fundId: "" }, { aggregateVersion: 0 },
      { lastEventId: "invalid" }, { lastEventAt: "invalid" },
    ]) expect(() => reduceFundBalance({ ...first, ...patch }, transaction())).toThrow(FundBalanceReductionError)
    expect(() => reduceFundBalance(undefined as unknown as FundBalanceState, transaction())).toThrow(/Previous Fund state/)
  })

  it("returns a fresh frozen flat state without modifying the event, payload or previous state", () => {
    const event = deepFreeze(opening())
    const eventBefore = structuredClone(event)
    const first = reduceFundBalance(null, event)
    const firstBefore = structuredClone(first)
    const update = deepFreeze(metadata(2, { description: "Bakı — 東京", targetAmount: null }))
    const updateBefore = structuredClone(update)
    const second = reduceFundBalance(first, update)
    expect(second).not.toBe(first)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(second)).toBe(true)
    expect(Reflect.set(second, "balance", "99.0000")).toBe(false)
    expect(first).toEqual(firstBefore)
    expect(event).toEqual(eventBefore)
    expect(update).toEqual(updateBefore)
    expect(Object.values(second).every(value => ["string", "number"].includes(typeof value))).toBe(true)
    expect(reduceFundBalance(first, update)).toEqual(second)
  })
})
