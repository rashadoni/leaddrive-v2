import { describe, expect, it, vi } from "vitest"
import { parseAcceptanceReceipt, parseSubmission, ReceiverContractError, utcTime, type Submission } from "../lib/integrations/customer-receiver/contract"
import { classifyDeliveryResponse, deliveryKey, nextRetryTime, prepareSubmission, recoveryAction, type ReceiverBinding } from "../lib/integrations/customer-receiver/delivery"
import { enqueueReceiverSubmission } from "../lib/integrations/customer-receiver/outbox"

const binding: ReceiverBinding = { integrationId: "receiver-1", organizationId: "org-1", environment: "TEST", enabled: true, contractApproved: true }
const customer = {
  schemaVersion: "1.0", eventId: "10000000-0000-4000-8000-000000000001",
  sourceSystem: "LeadDrive", externalId: "crm-customer-1", entityVersion: 3,
  occurredAt: "2026-10-14T08:00:00Z",
  customer: { type: "legal_entity", name: "DEMO CUSTOMER", countryCode: "AZ", email: "contact@example.invalid" },
}
const deal = {
  schemaVersion: "1.0", eventId: "10000000-0000-4000-8000-000000000002",
  externalId: "crm-deal-1", entityVersion: 1, occurredAt: "2026-10-14T08:00:01Z",
  customerExternalId: "crm-customer-1",
  deal: { name: "DEMO DEAL", stageCode: "QUALIFIED", amount: "1500.00", currency: "AZN", expectedCloseDate: "2026-11-01" },
}
const submission = () => parseSubmission("customers", structuredClone(customer))
const receipt = () => ({ operationId: "op-1", eventId: customer.eventId, externalId: customer.externalId,
  receiptId: "receipt-1", status: "accepted", acceptedVersion: 3, acceptedAt: "2026-10-14T08:00:02Z" })

describe("proposed customer receiving contract", () => {
  it("accepts the documented customer and deal shapes without ERP identifiers", () => {
    expect(submission().envelope).toEqual(customer)
    expect(parseSubmission("deals", deal).envelope).toEqual(deal)
  })
  it.each(["authorization", "password", "notes", "organizationId", "destinationUrl"])("rejects unapproved field %s instead of exporting it", (field) => {
    expect(() => parseSubmission("customers", { ...customer, [field]: "PRIVATE" })).toThrow(ReceiverContractError)
  })
  it("rejects unapproved nested fields and returns no rejected values in errors", () => {
    expect(() => parseSubmission("customers", { ...customer, customer: { ...customer.customer, password: "SECRET" } })).toThrow("Customer receiving contract validation failed")
  })
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "3"])("rejects invalid entity version %s", (entityVersion) => {
    expect(() => parseSubmission("customers", { ...customer, entityVersion })).toThrow()
  })
  it.each(["2026-02-30T00:00:00Z", "2026-10-14T08:00:00+04:00", "invalid", "2026-10-14T24:00:00Z"])("rejects invalid/non-UTC timestamp %s", (occurredAt) => {
    expect(() => parseSubmission("customers", { ...customer, occurredAt })).toThrow()
  })
  it("accepts both documented second precision and normalized millisecond UTC", () => {
    expect(utcTime("2026-10-14T08:00:00.123Z")).toBe("2026-10-14T08:00:00.123Z")
  })
  it.each([1500, "1e3", "NaN", "-1.00", "1.001", "01.00"])("rejects ambiguous or out-of-profile amount %s", (amount) => {
    expect(() => parseSubmission("deals", { ...deal, deal: { ...deal.deal, amount } })).toThrow()
  })
  it("rejects invalid calendar dates and ERP-ID-only deal references", () => {
    expect(() => parseSubmission("deals", { ...deal, deal: { ...deal.deal, expectedCloseDate: "2026-02-30" } })).toThrow()
    expect(() => parseSubmission("deals", { ...deal, customerExternalId: undefined, customerErpId: "erp-1" })).toThrow()
  })
  it("copies payload so source-row changes cannot change a prepared delivery", () => {
    const original = structuredClone(customer)
    const parsed = parseSubmission("customers", original)
    original.customer.name = "CHANGED"
    expect((parsed.envelope as typeof customer).customer.name).toBe("DEMO CUSTOMER")
  })
})

describe("delivery identity and tenant boundary", () => {
  it("keeps the key stable for one event and changes the payload hash for altered data", () => {
    const first = prepareSubmission(binding, "org-1", submission())
    const changed = prepareSubmission(binding, "org-1", parseSubmission("customers", { ...customer, customer: { ...customer.customer, name: "CHANGED" } }))
    expect(changed.idempotencyKey).toBe(first.idempotencyKey)
    expect(changed.payloadHash).not.toBe(first.payloadHash)
    expect(first.relativePath).toBe("/integration/v1/customers/crm-customer-1")
  })
  it("separates keys across tenant, integration and environment", () => {
    const base = deliveryKey(binding, submission())
    for (const changed of [{ ...binding, organizationId: "org-2" }, { ...binding, integrationId: "receiver-2" }, { ...binding, environment: "PROD" as const }]) {
      expect(deliveryKey(changed, submission())).not.toBe(base)
    }
  })
  it("rejects another tenant, disabled connector and unapproved contract", () => {
    expect(() => prepareSubmission(binding, "org-2", submission())).toThrow()
    expect(() => prepareSubmission({ ...binding, enabled: false }, "org-1", submission())).toThrow()
    expect(() => prepareSubmission({ ...binding, contractApproved: false }, "org-1", submission())).toThrow()
  })
})

describe("receipt and recovery", () => {
  it.each([200, 201, 202])("requires a valid receipt even for HTTP %s", (status) => {
    expect(classifyDeliveryResponse(submission(), { status, body: "{}" })).toEqual({ status: "unknown", reason: "invalid_receipt" })
    expect(classifyDeliveryResponse(submission(), { status, body: JSON.stringify(receipt()) }).status).toBe("accepted_by_api")
  })
  it.each([
    { eventId: deal.eventId }, { externalId: "another-customer" }, { acceptedVersion: 2 },
    { acceptedVersion: "3" }, { status: "erp_applied" }, { error: "failed" }, { acceptedAt: "2026-02-30T00:00:00Z" },
  ])("rejects a mismatched or non-acceptance receipt %j", (change) => {
    expect(() => parseAcceptanceReceipt({ ...receipt(), ...change }, submission())).toThrow()
  })
  it("never persists receiver error text through a classified result", () => {
    expect(JSON.stringify(classifyDeliveryResponse(submission(), { status: 500, body: "SECRET" }))).not.toContain("SECRET")
  })
  it.each([302, 429, 500, 503])("keeps an uncertain HTTP %s response out of accepted state", (status) => {
    expect(classifyDeliveryResponse(submission(), { status, body: JSON.stringify(receipt()) }).status).toBe("unknown")
  })
  it("requires reconciliation and a dedup guarantee before replaying an uncertain event", () => {
    const base = { outcome: classifyDeliveryResponse(submission(), null), receiptLookupCompleted: false,
      durableIdempotencyConfirmed: true, attempt: 1, maximumAttempts: 5 }
    expect(recoveryAction(base)).toBe("lookup_receipt")
    expect(recoveryAction({ ...base, receiptLookupCompleted: true, durableIdempotencyConfirmed: false })).toBe("manual_review")
    expect(recoveryAction({ ...base, receiptLookupCompleted: true })).toBe("retry_same_event")
    expect(recoveryAction({ ...base, receiptLookupCompleted: true, attempt: 5 })).toBe("manual_review")
  })
  it("never resends an accepted event, even without a final ERP result", () => {
    const outcome = classifyDeliveryResponse(submission(), { status: 202, body: JSON.stringify(receipt()) })
    expect(recoveryAction({ outcome, receiptLookupCompleted: false, durableIdempotencyConfirmed: true, attempt: 1, maximumAttempts: 5 })).toBe("stop_accepted")
  })
})

describe("transactional enqueue adapter", () => {
  it("uses the supplied transaction and stores no token or endpoint in the effect", async () => {
    const create = vi.fn().mockResolvedValue({ id: "effect-1" })
    await enqueueReceiverSubmission({ effectOutbox: { create } }, { binding, organizationId: "org-1", submission: submission(), correlationId: "corr-1", mode: "live" })
    const { data } = create.mock.calls[0][0]
    expect(data).toMatchObject({ organizationId: "org-1", effectType: "customer_receiver.submit.v1", status: "pending", destination: "customer-receiver:receiver-1:TEST" })
    expect(data.payload.envelope).toEqual(customer)
    expect(data.effectKey).toBe(deliveryKey(binding, submission()))
  })
  it.each(["shadow", "replay"] as const)("fences %s before writing an effect", async (mode) => {
    const create = vi.fn()
    await expect(enqueueReceiverSubmission({ effectOutbox: { create } }, { binding, organizationId: "org-1", submission: submission(), correlationId: "corr-1", mode })).rejects.toThrow()
    expect(create).not.toHaveBeenCalled()
  })
  it("propagates storage failure to the surrounding business transaction", async () => {
    const failure = new Error("storage unavailable")
    await expect(enqueueReceiverSubmission({ effectOutbox: { create: vi.fn().mockRejectedValue(failure) } }, { binding, organizationId: "org-1", submission: submission(), correlationId: "corr-1", mode: "live" })).rejects.toBe(failure)
  })
  it("rejects cross-tenant writes before accessing storage", async () => {
    const create = vi.fn()
    await expect(enqueueReceiverSubmission({ effectOutbox: { create } }, { binding, organizationId: "org-2", submission: submission() as Submission, correlationId: "corr-1", mode: "live" })).rejects.toThrow()
    expect(create).not.toHaveBeenCalled()
  })
})

describe("bounded retry schedule", () => {
  const now = Date.parse("2026-10-14T08:00:00Z")
  const base = { now, firstAttemptAt: now, attempt: 1, jitter: 0 }
  it("waits 1, 5, 15, then 60 minutes and adds only positive jitter", () => {
    expect([1, 2, 3, 4, 5].map((attempt) => nextRetryTime({ ...base, attempt })! - now)).toEqual([60_000, 300_000, 900_000, 3_600_000, 3_600_000])
    expect(nextRetryTime({ ...base, jitter: 1 })).toBe(now + 66_000)
  })
  it("respects Retry-After seconds and HTTP dates", () => {
    expect(nextRetryTime({ ...base, retryAfter: "600" })).toBe(now + 600_000)
    expect(nextRetryTime({ ...base, retryAfter: "Wed, 14 Oct 2026 08:15:00 GMT" })).toBe(now + 900_000)
    expect(nextRetryTime({ ...base, retryAfter: "-30" })).toBe(now + 60_000)
  })
  it("leaves work for manual recovery after the 24-hour window", () => {
    expect(nextRetryTime({ ...base, now: now + 24 * 60 * 60 * 1000 })).toBeNull()
    expect(nextRetryTime({ ...base, retryAfter: "86400" })).toBeNull()
    expect(nextRetryTime({ ...base, retryAfter: "9".repeat(100) })).toBeNull()
  })
})
