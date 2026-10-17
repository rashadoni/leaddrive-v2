/** Proposed receiving contract v1.0. Native ERP mapping belongs to the customer. */
export class ReceiverContractError extends Error {
  constructor() {
    // Never include rejected payloads, values or receiver error bodies.
    super("Customer receiving contract validation failed")
    this.name = "ReceiverContractError"
  }
}

export type ReceiverEnvironment = "TEST" | "PROD"
export type ReceiverResource = "customers" | "deals"

interface EnvelopeIdentity {
  schemaVersion: "1.0"
  eventId: string
  externalId: string
  entityVersion: number
  occurredAt: string
}

export interface CustomerEnvelope extends EnvelopeIdentity {
  sourceSystem: "LeadDrive"
  customer: {
    type: "legal_entity" | "individual"
    name: string
    countryCode: string
    email?: string
  }
}

export interface DealEnvelope extends EnvelopeIdentity {
  customerExternalId: string
  deal: {
    name: string
    stageCode: string
    amount: string
    currency: string
    expectedCloseDate?: string
  }
}

export type Submission =
  | { resource: "customers"; envelope: CustomerEnvelope }
  | { resource: "deals"; envelope: DealEnvelope }

export interface AcceptanceReceipt {
  operationId: string
  eventId: string
  externalId: string
  receiptId: string
  status: "accepted"
  acceptedVersion: number
  acceptedAt: string
}

export function contractAssert(condition: unknown): asserts condition {
  if (!condition) throw new ReceiverContractError()
}

export function record(value: unknown): Record<string, unknown> {
  contractAssert(value !== null && typeof value === "object" && !Array.isArray(value))
  const prototype = Object.getPrototypeOf(value)
  contractAssert(prototype === Object.prototype || prototype === null)
  return value as Record<string, unknown>
}

export function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  contractAssert(Object.keys(value).every((key) => allowed.includes(key)))
}

export function identifier(value: unknown): string {
  contractAssert(typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value))
  return value
}

export function uuid(value: unknown): string {
  contractAssert(typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
  return value
}

export function utcTime(value: unknown): string {
  contractAssert(typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value))
  const ms = Date.parse(value)
  contractAssert(Number.isFinite(ms))
  contractAssert(new Date(ms).toISOString() === (value.includes(".") ? value : value.slice(0, -1) + ".000Z"))
  return value
}

function text(value: unknown, max: number): string {
  contractAssert(typeof value === "string" && value.trim().length > 0 && value.length <= max)
  contractAssert(!Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
  return value
}

function identity(raw: Record<string, unknown>): EnvelopeIdentity {
  contractAssert(raw.schemaVersion === "1.0")
  contractAssert(Number.isSafeInteger(raw.entityVersion) && (raw.entityVersion as number) > 0)
  return {
    schemaVersion: "1.0",
    eventId: uuid(raw.eventId),
    externalId: identifier(raw.externalId),
    entityVersion: raw.entityVersion as number,
    occurredAt: utcTime(raw.occurredAt),
  }
}

/** Validates and copies only the agreed wire fields. Never spreads a CRM row. */
export function parseSubmission(resource: ReceiverResource, input: unknown): Submission {
  const raw = record(input)
  const common = ["schemaVersion", "eventId", "externalId", "entityVersion", "occurredAt"]
  const base = identity(raw)
  if (resource === "customers") {
    exactKeys(raw, [...common, "sourceSystem", "customer"])
    contractAssert(raw.sourceSystem === "LeadDrive")
    const data = record(raw.customer)
    exactKeys(data, ["type", "name", "countryCode", "email"])
    contractAssert(data.type === "legal_entity" || data.type === "individual")
    contractAssert(typeof data.countryCode === "string" && /^[A-Z]{2}$/.test(data.countryCode))
    const customer: CustomerEnvelope["customer"] = {
      type: data.type,
      name: text(data.name, 300),
      countryCode: data.countryCode,
    }
    if (data.email !== undefined) {
      const email = text(data.email, 254)
      contractAssert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      customer.email = email
    }
    return { resource, envelope: { ...base, sourceSystem: "LeadDrive", customer } }
  }
  contractAssert(resource === "deals")
  exactKeys(raw, [...common, "customerExternalId", "deal"])
  const data = record(raw.deal)
  exactKeys(data, ["name", "stageCode", "amount", "currency", "expectedCloseDate"])
  // This baseline profile uses nonnegative decimal strings with two places.
  // A different precision/credit flow needs an approved contract revision.
  contractAssert(typeof data.amount === "string" && /^(0|[1-9]\d{0,15})\.\d{2}$/.test(data.amount))
  contractAssert(typeof data.currency === "string" && /^[A-Z]{3}$/.test(data.currency))
  const deal: DealEnvelope["deal"] = {
    name: text(data.name, 300), stageCode: identifier(data.stageCode),
    amount: data.amount, currency: data.currency,
  }
  if (data.expectedCloseDate !== undefined) {
    contractAssert(typeof data.expectedCloseDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.expectedCloseDate))
    utcTime(`${data.expectedCloseDate}T00:00:00Z`)
    deal.expectedCloseDate = data.expectedCloseDate
  }
  return { resource, envelope: { ...base, customerExternalId: identifier(raw.customerExternalId), deal } }
}

/** A receipt is useful only when it identifies the exact submitted event/version. */
export function parseAcceptanceReceipt(input: unknown, submitted: Submission): AcceptanceReceipt {
  const raw = record(input)
  exactKeys(raw, ["operationId", "eventId", "externalId", "receiptId", "status", "acceptedVersion", "acceptedAt"])
  contractAssert(raw.status === "accepted")
  contractAssert(raw.eventId === submitted.envelope.eventId)
  contractAssert(raw.externalId === submitted.envelope.externalId)
  contractAssert(raw.acceptedVersion === submitted.envelope.entityVersion)
  return {
    operationId: identifier(raw.operationId), eventId: uuid(raw.eventId),
    externalId: identifier(raw.externalId), receiptId: identifier(raw.receiptId),
    status: "accepted", acceptedVersion: submitted.envelope.entityVersion,
    acceptedAt: utcTime(raw.acceptedAt),
  }
}
