import type { DomainEventEnvelope } from "./envelope"
import { assertEventContract, FUND_EVENT_CONTRACTS } from "./fund-contracts"

/** Balance only: no current eligibility, projection activation or effects. */
export interface FundBalanceState {
  readonly organizationId: string
  readonly fundId: string
  readonly balance: string
  readonly currency: string
  readonly aggregateVersion: number
  readonly lastEventId: string
  readonly lastEventAt: string
}

export class FundBalanceReductionError extends Error {
  readonly code = "FUND_BALANCE_REDUCTION_INVALID"

  constructor(message: string) {
    super(message)
    this.name = "FundBalanceReductionError"
  }
}

const IDENTIFIER = /^[^\s:\u0000-\u001f\u007f]{1,191}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MONEY = /^-?(?:0|[1-9][0-9]{0,13})\.[0-9]{4}$/
const NON_NEGATIVE_MONEY = /^(?:0|[1-9][0-9]{0,13})\.[0-9]{4}$/
const UTC_TIMESTAMP = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?Z$/
const SCALE = 10_000n
const BALANCE_LIMIT = 1_000_000_000_000_000_000n // Exclusive NUMERIC(18,4) scaled bound.

function reject(message: string): never {
  throw new FundBalanceReductionError(message)
}

function requireIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) reject(`Invalid ${label}`)
}

function requireEventId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !UUID.test(value)) reject("Event identity must be a UUID")
}

function requireVersion(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    reject("Aggregate version must be a positive safe integer")
  }
}

function requireTime(value: unknown): asserts value is string {
  if (typeof value !== "string" || !UTC_TIMESTAMP.test(value)) reject("Event time must be a UTC timestamp")
  const parsed = new Date(value)
  // Reject impossible calendar dates which Date would otherwise normalize.
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value.slice(0, 10)) {
    reject("Event time must be a valid UTC timestamp")
  }
}

function requireCurrency(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) reject("Invalid Fund currency")
}

function scaledMoney(value: unknown, nonNegative = false): bigint {
  if (typeof value !== "string" || !(nonNegative ? NON_NEGATIVE_MONEY : MONEY).test(value)) {
    reject("Money must be an exact four-decimal NUMERIC(18,4) string")
  }
  const negative = value.startsWith("-")
  const [whole, fraction] = (negative ? value.slice(1) : value).split(".")
  const scaled = BigInt(whole) * SCALE + BigInt(fraction)
  return negative ? -scaled : scaled
}

function requireBalance(scaled: bigint): void {
  if (scaled < 0n || scaled >= BALANCE_LIMIT) reject("Fund balance is outside non-negative NUMERIC(18,4)")
}

function formatBalance(scaled: bigint): string {
  requireBalance(scaled)
  return `${scaled / SCALE}.${(scaled % SCALE).toString().padStart(4, "0")}`
}

function validatePrevious(previous: FundBalanceState): bigint {
  if (!previous || typeof previous !== "object" || Array.isArray(previous)) reject("Previous Fund state is invalid")
  requireIdentifier(previous.organizationId, "previous tenant identity")
  requireIdentifier(previous.fundId, "previous Fund identity")
  requireCurrency(previous.currency)
  requireVersion(previous.aggregateVersion)
  requireEventId(previous.lastEventId)
  requireTime(previous.lastEventAt)
  const balance = scaledMoney(previous.balance, true)
  requireBalance(balance)
  return balance
}

/**
 * Fold canonical Fund facts in aggregate-version order, starting from null.
 * Every call rechecks the exact Fund payload contract; the upstream transport
 * still owns full envelope/provenance/hash validation, inbox deduplication,
 * tenant authorization and transaction/checkpoint/acknowledgement semantics.
 * Repeated deliveries are NOT no-ops here: filter them through the inbox first.
 *
 * No wall clock, DB writes, active v1/pointer changes, or external effects.
 * In particular, isActive is not a replay eligibility gate: historical ledger
 * facts can follow an opening describing a legacy Fund which is now inactive.
 */
export function reduceFundBalance(
  previous: FundBalanceState | null,
  event: DomainEventEnvelope,
): FundBalanceState {
  if (!event || typeof event !== "object" || Array.isArray(event)) reject("Fund event must be an object")
  if (event.specversion !== "1.0" || event.datacontenttype !== "application/json") reject("Unsupported event envelope")
  requireIdentifier(event.organizationid, "tenant identity")
  requireIdentifier(event.aggregateid, "Fund identity")
  requireEventId(event.id)
  requireVersion(event.aggregateversion)
  requireTime(event.time)
  if (typeof event.type !== "string" || !Object.hasOwn(FUND_EVENT_CONTRACTS, event.type)) {
    reject("Unsupported Fund event type")
  }
  if (typeof event.dataschema !== "string") reject("Fund event schema is required")
  assertEventContract({
    domain: "finance",
    aggregateType: event.aggregatetype,
    aggregateId: event.aggregateid,
    eventType: event.type,
    dataSchema: event.dataschema,
    classification: event.classification,
    data: event.data,
  })

  let balance: bigint
  let currency: string
  if (previous === null) {
    if (event.type !== "finance.fund-opened.v1" || event.aggregateversion !== 1) {
      reject("Fund history must begin with one opening event at version 1")
    }
    balance = scaledMoney(event.data.openingBalance, true)
    requireCurrency(event.data.currency)
    currency = event.data.currency
  } else {
    balance = validatePrevious(previous)
    if (previous.organizationId !== event.organizationid || previous.fundId !== event.aggregateid) {
      reject("Fund event does not belong to the previous tenant/Fund state")
    }
    if (event.type === "finance.fund-opened.v1") reject("A Fund stream can contain only one opening event")
    if (event.aggregateversion !== previous.aggregateVersion + 1) reject("Fund aggregate version must be the exact successor")
    if (event.id === previous.lastEventId) reject("Successive Fund events cannot reuse the same event identity")
    currency = previous.currency
    if (event.data.currency !== undefined && event.data.currency !== currency) reject("Fund currency is immutable")

    if (event.type === "finance.fund-transaction-recorded.v1") {
      balance += scaledMoney(event.data.signedDelta)
      requireBalance(balance)
      if (event.data.resultingBalance !== undefined && scaledMoney(event.data.resultingBalance, true) !== balance) {
        reject("Fund resultingBalance disagrees with the independently reduced balance")
      }
    }
    // The remaining registered metadata/archive/reactivation facts advance the
    // stream but have no monetary delta. Never re-evaluate command eligibility.
  }

  return Object.freeze({
    organizationId: event.organizationid,
    fundId: event.aggregateid,
    balance: formatBalance(balance),
    currency,
    aggregateVersion: event.aggregateversion,
    lastEventId: event.id,
    lastEventAt: event.time,
  })
}
