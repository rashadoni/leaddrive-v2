import { describe, expect, it, vi } from "vitest"
import {
  AggregateVersionConflictError,
  EventContractValidationError,
  EventIntegrityConflictError,
  IdempotencyConflictError,
  ReplayEffectFenceError,
  type CanonicalJsonValue,
  appendDomainEvent,
  assertEventContract,
  buildDomainEventEnvelope,
  canAutomaticallyRetryEffect,
  canPolicyRetryEffect,
  canonicalJson,
  consumeIdempotently,
  processKafkaEvent,
  validateKafkaEventRecord,
  enqueueEffect,
  findCommandReceipt,
  hashCanonicalJson,
  resolveEventProducerVersion,
} from "@/lib/event-platform"

describe("canonical event platform", () => {
  it("hashes equivalent command objects identically", () => {
    const first = { amount: "10.0000", nested: { z: true, a: 1 }, ignored: undefined }
    const second = { nested: { a: 1, z: true }, amount: "10.0000" }

    expect(canonicalJson(first)).toBe('{"amount":"10.0000","nested":{"a":1,"z":true}}')
    expect(hashCanonicalJson(first)).toBe(hashCanonicalJson(second))
    expect(hashCanonicalJson(first)).toMatch(/^[0-9a-f]{64}$/)
  })

  it("uses the compiled release SHA in production and never trusts a runtime fallback there", () => {
    const uppercaseSha = "ABCDEF0123456789ABCDEF0123456789ABCDEF01"
    expect(resolveEventProducerVersion({
      compiledSha: uppercaseSha,
      nodeEnv: "production",
      environment: { GIT_SHA: "1".repeat(40) },
    })).toBe(uppercaseSha.toLowerCase())

    expect(() => resolveEventProducerVersion({
      compiledSha: "",
      nodeEnv: "production",
      environment: { GIT_SHA: "1".repeat(40) },
    })).toThrow("valid compiled DEPLOY_SHA")
    expect(() => resolveEventProducerVersion({
      compiledSha: "not-a-release",
      nodeEnv: "production",
    })).toThrow("valid compiled DEPLOY_SHA")
  })

  it("uses only validated SHA fallbacks outside production", () => {
    const uppercaseSha = "ABCDEF0123456789ABCDEF0123456789ABCDEF01"
    expect(resolveEventProducerVersion({
      compiledSha: "",
      nodeEnv: "test",
      environment: { GITHUB_SHA: uppercaseSha },
    })).toBe(uppercaseSha.toLowerCase())
    expect(resolveEventProducerVersion({
      compiledSha: "",
      nodeEnv: "development",
      environment: { GIT_SHA: "branch-name-is-not-a-sha" },
    })).toBe("dev-local")
  })

  it("accepts every live, bootstrap and rollback-compatibility Fund payload contract", () => {
    const fixture = (
      eventType: string,
      dataSchema: string,
      data: Record<string, CanonicalJsonValue>,
    ) => {
      if (typeof data.fundId !== "string") throw new TypeError("fixture fundId is required")
      return {
        domain: "finance",
        aggregateType: "fund",
        aggregateId: data.fundId,
        eventType,
        dataSchema,
        classification: "confidential" as const,
        data,
      }
    }
    const fixtures = [
      fixture(
        "finance.fund-opened.v1",
        "urn:leaddrive:schema:finance.fund-opened:v1",
        {
          fundId: "fund-live",
          currency: "USD",
          openingBalance: "0.0000",
          targetAmount: "1000.0000",
          name: "Reserve",
          description: null,
          color: null,
          isActive: true,
          legacyBootstrap: false,
        },
      ),
      fixture(
        "finance.fund-opened.v1",
        "urn:leaddrive:schema:finance.fund-opened:v1",
        {
          fundId: "fund-bootstrap",
          currency: "USD",
          openingBalance: "85000.0000",
          storedBalance: "98000.0000",
          signedLegacyTransactionTotal: "13000.0000",
          legacyTransactionCount: 2,
          legacyBootstrap: true,
        },
      ),
      fixture(
        "finance.fund-opened.v1",
        "urn:leaddrive:schema:finance.fund-opened:v1",
        {
          fundId: "fund-compat",
          currency: "USD",
          openingBalance: "5.0000",
          name: "Legacy-created",
          isActive: true,
          legacyCompatibilityWrite: true,
        },
      ),
      fixture(
        "finance.fund-transaction-recorded.v1",
        "urn:leaddrive:schema:finance.fund-transaction-recorded:v1",
        {
          fundId: "fund-live",
          transactionId: "tx-live",
          transactionType: "deposit",
          amount: "10.0000",
          signedDelta: "10.0000",
          resultingBalance: "10.0000",
          currency: "USD",
          relatedType: "manual",
        },
      ),
      fixture(
        "finance.fund-transaction-recorded.v1",
        "urn:leaddrive:schema:finance.fund-transaction-recorded:v1",
        {
          fundId: "fund-bootstrap",
          transactionId: "tx-bootstrap",
          transactionType: "withdrawal",
          amount: "32.0000",
          signedDelta: "-32.0000",
          currency: "USD",
          relatedType: "manual",
          legacyBootstrap: true,
        },
      ),
      fixture(
        "finance.fund-transaction-recorded.v1",
        "urn:leaddrive:schema:finance.fund-transaction-recorded:v1",
        {
          fundId: "fund-compat",
          transactionId: "tx-compat",
          transactionType: "deposit",
          amount: "10.0000",
          signedDelta: "10.0000",
          resultingBalance: "15.0000",
          currency: "USD",
          legacyCompatibilityWrite: true,
        },
      ),
      fixture(
        "finance.fund-metadata-updated.v1",
        "urn:leaddrive:schema:finance.fund-metadata-updated:v1",
        {
          fundId: "fund-live",
          changedFields: ["name", "targetAmount"],
          name: "Operating reserve",
          description: null,
          targetAmount: "2000.0000",
          currency: "USD",
          color: null,
          isActive: true,
        },
      ),
      fixture(
        "finance.fund-metadata-updated.v1",
        "urn:leaddrive:schema:finance.fund-metadata-updated:v1",
        {
          fundId: "fund-compat",
          changedFields: ["description"],
          name: "Legacy-created",
          description: "Updated by rollback artifact",
          targetAmount: null,
          currency: "USD",
          color: null,
          isActive: true,
          legacyCompatibilityWrite: true,
        },
      ),
      fixture(
        "finance.fund-archived.v1",
        "urn:leaddrive:schema:finance.fund-archived:v1",
        { fundId: "fund-live", reason: "user-requested" },
      ),
      fixture(
        "finance.fund-archived.v1",
        "urn:leaddrive:schema:finance.fund-archived:v1",
        {
          fundId: "fund-compat",
          changedFields: ["isActive"],
          name: "Legacy-created",
          targetAmount: null,
          currency: "USD",
          isActive: false,
          legacyCompatibilityWrite: true,
        },
      ),
      fixture(
        "finance.fund-reactivated.v1",
        "urn:leaddrive:schema:finance.fund-reactivated:v1",
        {
          fundId: "fund-compat",
          changedFields: ["isActive"],
          name: "Legacy-created",
          targetAmount: null,
          currency: "USD",
          isActive: true,
          legacyCompatibilityWrite: true,
        },
      ),
    ]

    for (const contractFixture of fixtures) {
      expect(() => assertEventContract(contractFixture)).not.toThrow()
    }
  })

  it("rejects mismatched, unregistered and semantically invalid Fund contracts before SQL", async () => {
    expect(() => assertEventContract({
      domain: "finance",
      aggregateType: "fund",
      aggregateId: "fund-1",
      eventType: "finance.fund-opened.v1",
      dataSchema: "urn:leaddrive:schema:finance.fund-archived:v1",
      classification: "confidential",
      data: { fundId: "fund-1", currency: "USD", openingBalance: "0.0000" },
    })).toThrow(EventContractValidationError)
    expect(() => assertEventContract({
      domain: "finance",
      aggregateType: "fund",
      aggregateId: "fund-1",
      eventType: "finance.fund-renamed.v1",
      dataSchema: "urn:leaddrive:schema:finance.fund-renamed:v1",
      classification: "confidential",
      data: { fundId: "fund-1" },
    })).toThrow(EventContractValidationError)
    expect(() => assertEventContract({
      domain: "finance",
      aggregateType: "fund",
      aggregateId: "fund-1",
      eventType: "finance.other.v1",
      dataSchema: "urn:leaddrive:schema:other:v1",
      classification: "confidential",
      data: { fundId: "fund-1" },
    })).toThrow(EventContractValidationError)
    expect(() => assertEventContract({
      domain: "finance",
      aggregateType: "fund",
      aggregateId: "fund-1",
      eventType: "finance.fund-transaction-recorded.v1",
      dataSchema: "urn:leaddrive:schema:finance.fund-transaction-recorded:v1",
      classification: "confidential",
      data: {
        fundId: "fund-1",
        transactionId: "tx-1",
        transactionType: "withdrawal",
        amount: "10.0000",
        signedDelta: "10.0000",
        currency: "USD",
      },
    })).toThrow(EventContractValidationError)
    expect(() => assertEventContract({
      domain: "finance",
      aggregateType: "fund",
      aggregateId: "fund-1",
      eventType: "finance.fund-opened.v1",
      dataSchema: "urn:leaddrive:schema:finance.fund-opened:v1",
      classification: "confidential",
      data: { fundId: "fund-1", currency: "USD", openingBalance: "-1.0000" },
    })).toThrow(EventContractValidationError)
    expect(() => assertEventContract({
      domain: "finance",
      aggregateType: "fund",
      aggregateId: "fund-1",
      eventType: "finance.fund-archived.v1",
      dataSchema: "urn:leaddrive:schema:finance.fund-archived:v1",
      classification: "confidential",
      data: { fundId: "fund-2", reason: "user-requested" },
    })).toThrow(EventContractValidationError)

    const tx = {
      $queryRawUnsafe: vi.fn(),
      domainEvent: { create: vi.fn() },
      eventOutbox: { create: vi.fn() },
    }
    await expect(appendDomainEvent(tx, {
      organizationId: "org-1",
      domain: "finance",
      aggregateType: "fund",
      aggregateId: "fund-1",
      eventType: "finance.other.v1",
      source: "urn:leaddrive:finance",
      dataSchema: "urn:leaddrive:schema:other:v1",
      classification: "confidential",
      producer: "finance-api",
      producerVersion: "abcdef123",
      data: { fundId: "fund-1" },
    })).rejects.toBeInstanceOf(EventContractValidationError)
    await expect(appendDomainEvent(tx, {
      organizationId: "org-1",
      domain: "finance",
      aggregateType: "fund",
      aggregateId: "fund-1",
      eventType: "finance.fund-archived.v1",
      source: "urn:leaddrive:finance",
      dataSchema: "urn:leaddrive:schema:finance.fund-opened:v1",
      classification: "confidential",
      producer: "finance-api",
      producerVersion: "abcdef123",
      data: { fundId: "fund-1", reason: "user-requested" },
    })).rejects.toBeInstanceOf(EventContractValidationError)
    expect(tx.$queryRawUnsafe).not.toHaveBeenCalled()
  })

  it("allocates a version then inserts event and outbox with one stable ID", async () => {
    const tx = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ currentVersion: 2n }]),
      domainEvent: { create: vi.fn().mockResolvedValue({ payloadHash: "a".repeat(64) }) },
      eventOutbox: { create: vi.fn().mockResolvedValue({ payloadHash: "b".repeat(64) }) },
    }
    const appended = await appendDomainEvent(tx, {
      organizationId: "org-1",
      domain: "finance",
      aggregateType: "fund",
      aggregateId: "fund-1",
      expectedVersion: 1,
      eventId: "018f7b34-9bb9-7b32-8de8-1fbb4feeb331",
      eventType: "finance.fund-transaction-recorded.v1",
      source: "urn:leaddrive:finance",
      dataSchema: "urn:leaddrive:schema:finance.fund-transaction-recorded:v1",
      classification: "confidential",
      correlationId: "corr-1",
      producer: "finance-api",
      producerVersion: "abcdef123",
      data: {
        fundId: "fund-1",
        transactionId: "tx-1",
        transactionType: "deposit",
        amount: "10.0000",
        signedDelta: "10.0000",
        resultingBalance: "10.0000",
        currency: "USD",
      },
      occurredAt: new Date("2026-09-01T12:00:00.000Z"),
    })

    expect(appended).toMatchObject({
      eventId: "018f7b34-9bb9-7b32-8de8-1fbb4feeb331",
      aggregateVersion: 2n,
      topic: "leaddrive.domain.finance.v1",
      partitionKey: "org-1:fund:fund-1",
      payloadHash: "b".repeat(64),
    })
    expect(tx.domainEvent.create).toHaveBeenCalledOnce()
    expect(tx.eventOutbox.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventId: appended.eventId,
        envelope: expect.objectContaining({
          id: appended.eventId,
          aggregateversion: 2,
          data: expect.objectContaining({ amount: "10.0000" }),
        }),
      }),
    }))
  })

  it("fails closed when optimistic aggregate allocation returns no row", async () => {
    const tx = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
      domainEvent: { create: vi.fn() },
      eventOutbox: { create: vi.fn() },
    }
    await expect(appendDomainEvent(tx, {
      organizationId: "org-1",
      domain: "finance",
      aggregateType: "fund",
      aggregateId: "fund-1",
      expectedVersion: 7,
      eventType: "finance.fund-archived.v1",
      source: "urn:leaddrive:finance",
      dataSchema: "urn:leaddrive:schema:finance.fund-archived:v1",
      classification: "confidential",
      producer: "finance-api",
      producerVersion: "abcdef123",
      data: { fundId: "fund-1", reason: "user-requested" },
    })).rejects.toBeInstanceOf(AggregateVersionConflictError)
    expect(tx.domainEvent.create).not.toHaveBeenCalled()
  })

  it("replays a command receipt only when its request hash matches", async () => {
    const db = {
      eventCommandReceipt: {
        findUnique: vi.fn().mockResolvedValue({
          id: "receipt-1",
          requestHash: "a".repeat(64),
          responseStatus: 201,
          responseBody: { data: { id: "tx-1" } },
          eventIds: ["018f7b34-9bb9-7b32-8de8-1fbb4feeb331"],
        }),
        create: vi.fn(),
      },
    }
    const identity = {
      organizationId: "org-1",
      commandType: "finance.RecordFundTransaction.v1",
      idempotencyKey: "idem-key-1",
      requestHash: "a".repeat(64),
    }

    await expect(findCommandReceipt(db, identity)).resolves.toMatchObject({ id: "receipt-1" })
    await expect(findCommandReceipt(db, { ...identity, requestHash: "b".repeat(64) }))
      .rejects.toBeInstanceOf(IdempotencyConflictError)
  })

  it("makes duplicate delivery a no-op and quarantines a hash conflict", async () => {
    const apply = vi.fn().mockResolvedValue({ balance: "10.0000" })
    const base = {
      organizationId: "org-1",
      consumerName: "fund-balance",
      consumerVersion: 2,
      eventId: "018f7b34-9bb9-7b32-8de8-1fbb4feeb331",
      eventType: "finance.fund-transaction-recorded.v1",
      payloadHash: "a".repeat(64),
      sourceTopic: "leaddrive.domain.finance.v1",
      sourcePartition: 0,
      sourceOffset: 42n,
    }
    const duplicateTx = {
      consumerInbox: {
        findUnique: vi.fn().mockResolvedValue({ payloadHash: base.payloadHash, result: { balance: "10.0000" } }),
        create: vi.fn(),
      },
    }

    await expect(consumeIdempotently(duplicateTx, base, apply)).resolves.toEqual({
      duplicate: true,
      result: { balance: "10.0000" },
    })
    expect(apply).not.toHaveBeenCalled()

    duplicateTx.consumerInbox.findUnique.mockResolvedValue({
      payloadHash: "b".repeat(64),
      result: {},
    })
    await expect(consumeIdempotently(duplicateTx, base, apply))
      .rejects.toBeInstanceOf(EventIntegrityConflictError)
  })

  it("rejects Kafka tenant identity disagreement before projection work", () => {
    const envelope = buildDomainEventEnvelope({
      id: "018f7b34-9bb9-7b32-8de8-1fbb4feeb331",
      source: "/finance/funds",
      type: "finance.fund-transaction-recorded.v1",
      time: new Date("2026-09-01T10:00:00.000Z"),
      dataSchema: "urn:leaddrive:schema:finance:fund-transaction-recorded:1",
      organizationId: "org-1",
      aggregateType: "fund",
      aggregateId: "fund-1",
      aggregateVersion: 2,
      producer: "leaddrive-web",
      producerVersion: "0123456789012345678901234567890123456789",
      classification: "confidential",
      data: { amount: "10.0000" },
    })
    const record = {
      topic: "ld.prod.finance.events.v1",
      partition: 1,
      offset: "42",
      key: "org-1:fund:fund-1",
      value: JSON.stringify(envelope),
      headers: {
        eventtype: envelope.type,
        organizationid: "org-2",
        payloadhash: "a".repeat(64),
      },
    }
    expect(() => validateKafkaEventRecord(record, "prod")).toThrow(EventIntegrityConflictError)
  })

  it("acknowledges Kafka only after a committed idempotent transaction and fences replay effects", async () => {
    const envelope = buildDomainEventEnvelope({
      id: "018f7b34-9bb9-7b32-8de8-1fbb4feeb331",
      source: "/finance/funds",
      type: "finance.fund-transaction-recorded.v1",
      time: new Date("2026-09-01T10:00:00.000Z"),
      dataSchema: "urn:leaddrive:schema:finance:fund-transaction-recorded:1",
      organizationId: "org-1",
      aggregateType: "fund",
      aggregateId: "fund-1",
      aggregateVersion: 2,
      producer: "leaddrive-web",
      producerVersion: "0123456789012345678901234567890123456789",
      classification: "confidential",
      data: { amount: "10.0000" },
    })
    const order: string[] = []
    const result = await processKafkaEvent({
      record: {
        topic: "ld.prod.finance.events.v1",
        partition: 1,
        offset: "42",
        key: "org-1:fund:fund-1",
        value: JSON.stringify(envelope),
        headers: { eventtype: envelope.type, organizationid: "org-1", payloadhash: "a".repeat(64) },
      },
      environment: "prod",
      consumerName: "fund-balance",
      consumerVersion: 2,
      mode: "replay",
      transaction: async (_event, apply) => {
        const value = await apply()
        order.push("commit")
        return { duplicate: false, result: value }
      },
      apply: async (_event, context) => {
        expect(context.effectsAllowed).toBe(false)
        order.push("apply")
        return { balance: "10.0000" }
      },
      acknowledge: async () => { order.push("ack") },
    })
    expect(result).toEqual({ duplicate: false, result: { balance: "10.0000" } })
    expect(order).toEqual(["apply", "commit", "ack"])
  })

  it("does not acknowledge Kafka when projection transaction fails", async () => {
    const acknowledge = vi.fn()
    await expect(processKafkaEvent({
      record: {
        topic: "ld.prod.finance.events.v1",
        partition: 0,
        offset: "1",
        key: "org-1:fund:fund-1",
        value: "{}",
        headers: { eventtype: "finance.test.v1", organizationid: "org-1", payloadhash: "a".repeat(64) },
      },
      environment: "prod",
      consumerName: "fund-balance",
      consumerVersion: 1,
      mode: "live",
      transaction: vi.fn(),
      apply: vi.fn(),
      acknowledge,
    })).rejects.toThrow()
    expect(acknowledge).not.toHaveBeenCalled()
  })

  it("fences external effects in replay and shadow modes", async () => {
    const tx = { effectOutbox: { create: vi.fn() } }
    const input = {
      organizationId: "org-1",
      effectType: "email.send",
      effectKey: "invoice-1-receipt",
      destination: "email-provider",
      payload: { templateId: "receipt" },
      mode: "replay" as const,
    }
    await expect(enqueueEffect(tx, input)).rejects.toBeInstanceOf(ReplayEffectFenceError)
    expect(tx.effectOutbox.create).not.toHaveBeenCalled()

    await expect(enqueueEffect(tx, { ...input, replaySafe: true }))
      .rejects.toBeInstanceOf(ReplayEffectFenceError)
  })

  it("never automatically retries an active or ambiguous effect", () => {
    expect(canAutomaticallyRetryEffect("pending")).toBe(true)
    expect(canAutomaticallyRetryEffect("leased")).toBe(false)
    expect(canAutomaticallyRetryEffect("definitely_failed")).toBe(false)
    expect(canAutomaticallyRetryEffect("reconciliation_required")).toBe(false)
    expect(canPolicyRetryEffect("definitely_failed")).toBe(true)
  })
})
