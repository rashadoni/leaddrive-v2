import { describe, expect, it } from "vitest"

import {
  PHARMACY_PROMOTION_OUTBOX_BATCH_MAX,
  PHARMACY_PROMOTION_OUTBOX_LEASE_MS,
  applyPharmacyPromotionServerOutcomes,
  canonicalPharmacyPromotionPayload,
  createPharmacyPromotionDraftOperation,
  createPharmacyPromotionEvidenceOperation,
  createPharmacyPromotionFlushCoordinator,
  createPharmacyPromotionSubmitOperation,
  enqueuePharmacyPromotionOperation,
  flushPharmacyPromotionOutbox,
  markPharmacyPromotionOperationsSyncing,
  pharmacyPromotionOperationBatches,
  pharmacyPromotionOperationsReady,
  pharmacyPromotionOutboxPayload,
  pharmacyPromotionOutboxRequest,
  pharmacyPromotionRetryDelay,
  retryPharmacyPromotionOperationNow,
  sendPharmacyPromotionOutboxRequests,
  type PharmacyPromotionOutboxEntry,
  type PharmacyPromotionOutboxStore,
} from "@/lib/mtm/pharmacy-promotion-outbox"

const NOW = 1_785_566_400_000
const SCOPE_KEY = "scope-org-1-agent-1"

function draft(
  operationId: string,
  now = NOW,
  overrides: Partial<Parameters<typeof createPharmacyPromotionDraftOperation>[0]> = {},
): PharmacyPromotionOutboxEntry {
  return createPharmacyPromotionDraftOperation({
    targetId: "target-12345678",
    visitId: "visit-12345678",
    factQuantity: "12.5000",
    unit: "packs",
    expectedVersion: 0,
    clientOccurredAt: "2026-08-01T08:00:00+00:00",
    ...overrides,
  }, {
    scopeKey: SCOPE_KEY,
    operationId,
    clientExecutionId: `execution-${operationId}`,
    now,
  })
}

function memoryStore(initial: readonly PharmacyPromotionOutboxEntry[]) {
  let entries = [...initial]
  const store: PharmacyPromotionOutboxStore = {
    async list(scopeKey) {
      return entries.filter((entry) => entry.scopeKey === scopeKey)
    },
    async put(next) {
      const storageKey = (entry: PharmacyPromotionOutboxEntry) => `${entry.scopeKey}\u0000${entry.operationId}`
      const byId = new Map(entries.map((entry) => [storageKey(entry), entry]))
      for (const entry of next) byId.set(storageKey(entry), entry)
      entries = [...byId.values()]
    },
    async remove(scopeKey, operationIds) {
      const removed = new Set(operationIds)
      entries = entries.filter((entry) => entry.scopeKey !== scopeKey || !removed.has(entry.operationId))
    },
  }
  return { store, snapshot: () => [...entries] }
}

describe("SWM-09 pharmacy-promotion durable outbox", () => {
  it("keeps binary evidence and its immutable upload identity in the scoped outbox", () => {
    const file = new Blob(["signed evidence"], { type: "text/plain" })
    const entry = createPharmacyPromotionEvidenceOperation({
      clientExecutionId: "execution-evidence-1",
      clientEvidenceId: "client-evidence-1",
      clientDocumentId: "client-document-1",
      capturedAt: "2026-08-08T08:00:00+00:00",
      checksumSha256: "a".repeat(64),
      fileName: "proof.txt",
      title: "Visit proof",
      file,
    }, {
      scopeKey: SCOPE_KEY,
      operationId: "operation-evidence-1",
      now: NOW,
    })

    expect(entry).toMatchObject({
      kind: "EVIDENCE",
      clientExecutionId: "execution-evidence-1",
      operationId: "operation-evidence-1",
      binary: file,
      status: "pending",
    })
    expect(pharmacyPromotionOutboxPayload(entry)).toEqual({
      capturedAt: "2026-08-08T08:00:00.000Z",
      checksumSha256: "a".repeat(64),
      clientDocumentId: "client-document-1",
      clientEvidenceId: "client-evidence-1",
      fileName: "proof.txt",
      mimeType: "text/plain",
      operationId: "operation-evidence-1",
      sizeBytes: file.size,
      title: "Visit proof",
    })
    expect(pharmacyPromotionOutboxRequest(entry).binary).toBe(file)
  })

  it("keeps stable operation and execution IDs with an immutable canonical payload", () => {
    const entry = draft("operation-stable")
    const firstPayload = pharmacyPromotionOutboxPayload(entry)

    expect(entry).toMatchObject({
      scopeKey: SCOPE_KEY,
      operationId: "operation-stable",
      clientExecutionId: "execution-operation-stable",
      kind: "DRAFT",
      status: "pending",
      attempts: 0,
    })
    expect(entry.payloadJson).toBe(canonicalPharmacyPromotionPayload({
      unit: "packs",
      targetId: "target-12345678",
      operationId: "operation-stable",
      factQuantity: "12.5",
      expectedVersion: 0,
      clientOccurredAt: "2026-08-01T08:00:00.000Z",
      clientExecutionId: "execution-operation-stable",
      visitId: "visit-12345678",
    }))

    firstPayload.operationId = "mutated-by-caller"
    expect(pharmacyPromotionOutboxPayload(entry)).toMatchObject({
      operationId: "operation-stable",
      factQuantity: "12.5",
    })

    expect(enqueuePharmacyPromotionOperation([entry], entry)).toEqual([entry])
    expect(() => enqueuePharmacyPromotionOperation([
      entry,
    ], draft("operation-stable", NOW, { factQuantity: "99" }))).toThrow(/cannot be reused/)
  })

  it("uses one bounded canonical fact quantity for numeric and string input", () => {
    const numeric = draft("operation-decimal", NOW, { factQuantity: 12.5 })
    const textual = draft("operation-decimal", NOW, { factQuantity: "0012.5000" })

    expect(numeric.payloadJson).toBe(textual.payloadJson)
    expect(pharmacyPromotionOutboxPayload(numeric)).toMatchObject({ factQuantity: "12.5" })

    const boundary = draft("operation-boundary", NOW, {
      factQuantity: "99999999999999.9999",
    })
    expect(pharmacyPromotionOutboxPayload(boundary)).toMatchObject({
      factQuantity: "99999999999999.9999",
    })

    for (const factQuantity of [12.50001, "12.50000", "100000000000000", Number.POSITIVE_INFINITY]) {
      expect(() => draft("operation-invalid", NOW, { factQuantity })).toThrow(/DECIMAL\(18,4\)/)
    }
    expect(() => draft("operation-version", NOW, { expectedVersion: 1 })).toThrow(/must equal 0/)
  })

  it("pins offline fact provenance to queue time and partitions operations by principal scope", async () => {
    const withoutClientClock = draft("operation-observed", NOW, { clientOccurredAt: undefined })
    expect(pharmacyPromotionOutboxPayload(withoutClientClock)).toMatchObject({
      clientOccurredAt: new Date(NOW).toISOString(),
    })

    const otherScope = createPharmacyPromotionDraftOperation({
      targetId: "target-other-scope",
      factQuantity: "1",
      unit: "packs",
    }, {
      scopeKey: "scope-org-2-agent-2",
      operationId: "operation-other-scope",
      clientExecutionId: "execution-other-scope",
      now: NOW,
    })
    const { store } = memoryStore([withoutClientClock, otherScope])
    await expect(store.list(SCOPE_KEY)).resolves.toEqual([withoutClientClock])
    await expect(store.list("scope-org-2-agent-2")).resolves.toEqual([otherScope])
  })

  it("keeps equal operation IDs independent across principal scopes", async () => {
    const first = draft("operation-shared-scope-key")
    const second = createPharmacyPromotionDraftOperation({
      targetId: "target-other-scope",
      factQuantity: "2",
      unit: "packs",
    }, {
      scopeKey: "scope-org-2-agent-2",
      operationId: first.operationId,
      clientExecutionId: "execution-other-scope-shared-op",
      now: NOW,
    })
    const { store } = memoryStore([])

    await store.put([first, second])
    await expect(store.list(SCOPE_KEY)).resolves.toEqual([first])
    await expect(store.list(second.scopeKey)).resolves.toEqual([second])

    await store.remove(SCOPE_KEY, [first.operationId])
    await expect(store.list(SCOPE_KEY)).resolves.toEqual([])
    await expect(store.list(second.scopeKey)).resolves.toEqual([second])
    expect(enqueuePharmacyPromotionOperation([first], second)).toEqual([first, second])
  })

  it("orders due operations and creates sequential batches capped at 100", () => {
    const entries = Array.from({ length: 205 }, (_, index) => (
      draft(`operation-${String(index).padStart(3, "0")}`, NOW + index)
    )).reverse()
    const batches = pharmacyPromotionOperationBatches(
      entries,
      NOW + 1_000,
      PHARMACY_PROMOTION_OUTBOX_BATCH_MAX + 50,
    )

    expect(batches.map((batch) => batch.length)).toEqual([100, 100, 5])
    expect(batches.flat().map((entry) => entry.operationId)).toEqual(
      Array.from({ length: 205 }, (_, index) => `operation-${String(index).padStart(3, "0")}`),
    )
  })

  it("keeps an offline draft ahead of its submit and blocks submit while the draft backs off", () => {
    const queuedDraft = draft("operation-chain-draft", NOW)
    const queuedSubmit = createPharmacyPromotionSubmitOperation({
      clientExecutionId: queuedDraft.clientExecutionId,
      expectedVersion: 1,
    }, {
      scopeKey: SCOPE_KEY,
      operationId: "operation-chain-submit",
      now: NOW,
    })

    expect(pharmacyPromotionOperationsReady([queuedSubmit, queuedDraft], NOW)).toEqual([
      queuedDraft,
      queuedSubmit,
    ])

    const backwardClockDraft = draft("operation-clock-draft", NOW + 100)
    const backwardClockSubmit = createPharmacyPromotionSubmitOperation({
      clientExecutionId: backwardClockDraft.clientExecutionId,
      expectedVersion: 1,
    }, {
      scopeKey: SCOPE_KEY,
      operationId: "operation-clock-submit",
      now: NOW,
    })
    expect(pharmacyPromotionOperationsReady(
      [backwardClockSubmit, backwardClockDraft],
      NOW + 100,
    )).toEqual([backwardClockDraft, backwardClockSubmit])

    const [claimedDraft] = markPharmacyPromotionOperationsSyncing(
      [queuedDraft],
      [queuedDraft.operationId],
      NOW,
    )
    const [failedDraft] = applyPharmacyPromotionServerOutcomes(
      [claimedDraft],
      [claimedDraft.operationId],
      [{ operationId: claimedDraft.operationId, status: "error", error: "offline" }],
      NOW + 1,
    ).entries
    expect(pharmacyPromotionOperationsReady([queuedSubmit, failedDraft], NOW + 2)).toEqual([])
    expect(pharmacyPromotionOperationsReady(
      [queuedSubmit, failedDraft],
      failedDraft.nextAttemptAt,
    )).toEqual([failedDraft, queuedSubmit])
  })

  it("retries the exact request after bounded exponential backoff", () => {
    const entry = draft("operation-retry")
    const payloadJson = entry.payloadJson
    const [claimed] = markPharmacyPromotionOperationsSyncing([entry], [entry.operationId], NOW)
    const applied = applyPharmacyPromotionServerOutcomes(
      [claimed],
      [entry.operationId],
      [{ operationId: entry.operationId, status: "error", error: "response lost" }],
      NOW + 100,
    )
    const [failed] = applied.entries

    expect(failed).toMatchObject({
      operationId: "operation-retry",
      clientExecutionId: "execution-operation-retry",
      status: "error",
      attempts: 1,
      nextAttemptAt: NOW + 100 + pharmacyPromotionRetryDelay(1),
    })
    expect(failed.payloadJson).toBe(payloadJson)
    expect(pharmacyPromotionOperationsReady([failed], failed.nextAttemptAt - 1)).toEqual([])
    expect(pharmacyPromotionOperationsReady([failed], failed.nextAttemptAt)).toEqual([failed])
    expect(pharmacyPromotionRetryDelay(30)).toBe(15 * 60_000)

    const retried = retryPharmacyPromotionOperationNow(failed, NOW + 200)
    expect(retried).toMatchObject({
      operationId: entry.operationId,
      clientExecutionId: entry.clientExecutionId,
      status: "pending",
      attempts: 1,
      nextAttemptAt: NOW + 200,
    })
    expect(retried.payloadJson).toBe(payloadJson)
  })

  it("persists a successor correction and retries its immutable supersession payload", async () => {
    const entry = draft("operation-correction", NOW, {
      supersedesExecutionId: "execution-approved-original",
      factQuantity: "14.25",
    })
    const payloadJson = entry.payloadJson
    const { store, snapshot } = memoryStore([entry])
    const sentPayloads: unknown[] = []
    let currentTime = NOW
    let sendAttempt = 0

    const send = async (requests: readonly { operationId: string; payload: unknown }[]) => {
      const request = requests[0]
      if (!request) throw new Error("Expected one correction operation")
      sentPayloads.push(request.payload)
      sendAttempt += 1
      return [{
        operationId: request.operationId,
        status: sendAttempt === 1 ? "error" as const : "ok" as const,
        ...(sendAttempt === 1 ? { error: "response lost" } : {}),
      }]
    }

    expect(payloadJson).toBe(canonicalPharmacyPromotionPayload({
      targetId: "target-12345678",
      supersedesExecutionId: "execution-approved-original",
      clientExecutionId: "execution-operation-correction",
      operationId: "operation-correction",
      visitId: "visit-12345678",
      factQuantity: "14.25",
      unit: "packs",
      expectedVersion: 0,
      clientOccurredAt: "2026-08-01T08:00:00.000Z",
    }))

    await expect(flushPharmacyPromotionOutbox({
      scopeKey: SCOPE_KEY,
      store,
      coordinator: createPharmacyPromotionFlushCoordinator(),
      send,
      now: () => currentTime,
    })).resolves.toMatchObject({ attempted: 1, accepted: 0, errors: 1 })

    const [persisted] = snapshot()
    expect(persisted.payloadJson).toBe(payloadJson)
    expect(pharmacyPromotionOutboxPayload(persisted)).toMatchObject({
      operationId: "operation-correction",
      clientExecutionId: "execution-operation-correction",
      supersedesExecutionId: "execution-approved-original",
      factQuantity: "14.25",
    })

    currentTime = persisted.nextAttemptAt
    await expect(flushPharmacyPromotionOutbox({
      scopeKey: SCOPE_KEY,
      store,
      coordinator: createPharmacyPromotionFlushCoordinator(),
      send,
      now: () => currentTime,
    })).resolves.toMatchObject({ attempted: 1, accepted: 1, errors: 0 })

    expect(sentPayloads).toHaveLength(2)
    expect(sentPayloads[0]).toEqual(sentPayloads[1])
    expect(sentPayloads[1]).toMatchObject({
      supersedesExecutionId: "execution-approved-original",
    })
    expect(snapshot()).toEqual([])
  })

  it("applies only exact per-operation server outcomes", () => {
    const accepted = draft("operation-ok")
    const missing = draft("operation-missing")
    const ambiguous = draft("operation-ambiguous")
    const claimedIds = [accepted.operationId, missing.operationId, ambiguous.operationId]
    const claimed = markPharmacyPromotionOperationsSyncing(
      [accepted, missing, ambiguous],
      claimedIds,
      NOW,
    )
    const applied = applyPharmacyPromotionServerOutcomes(claimed, claimedIds, [
      { operationId: accepted.operationId, status: "ok" },
      { operationId: ambiguous.operationId, status: "ok" },
      { operationId: ambiguous.operationId, status: "error", error: "duplicate" },
      { operationId: "operation-not-claimed", status: "ok" },
    ], NOW + 1)

    expect(applied.acceptedOperationIds).toEqual([accepted.operationId])
    expect(applied.errorOperationIds).toEqual([missing.operationId, ambiguous.operationId])
    expect(applied.entries.map((entry) => [entry.operationId, entry.lastError])).toEqual([
      [missing.operationId, "MTM_PHARMACY_SYNC_OUTCOME_MISSING"],
      [ambiguous.operationId, "MTM_PHARMACY_SYNC_OUTCOME_AMBIGUOUS"],
    ])
  })

  it("keeps conflicts terminal for explicit recovery", () => {
    const submit = createPharmacyPromotionSubmitOperation({
      clientExecutionId: "execution-conflict",
      expectedVersion: 4,
    }, { scopeKey: SCOPE_KEY, operationId: "submit-conflict", now: NOW })
    const [claimed] = markPharmacyPromotionOperationsSyncing(
      [submit],
      [submit.operationId],
      NOW,
    )
    const applied = applyPharmacyPromotionServerOutcomes([claimed], [submit.operationId], [{
      operationId: submit.operationId,
      status: "conflict",
      error: "Execution changed on the server",
      serverData: { version: 5 },
    }], NOW + 1)
    const [conflict] = applied.entries

    expect(conflict).toMatchObject({
      operationId: "submit-conflict",
      clientExecutionId: "execution-conflict",
      status: "conflict",
      attempts: 1,
      serverData: { version: 5 },
    })
    expect(pharmacyPromotionOperationsReady([conflict], Number.MAX_SAFE_INTEGER)).toEqual([])
    expect(retryPharmacyPromotionOperationNow(conflict, NOW + 2)).toBe(conflict)
  })

  it("recovers a stale syncing lease without changing IDs or payload", () => {
    const entry = draft("operation-lease")
    const [syncing] = markPharmacyPromotionOperationsSyncing(
      [entry],
      [entry.operationId],
      NOW,
    )

    expect(pharmacyPromotionOperationsReady(
      [syncing],
      NOW + PHARMACY_PROMOTION_OUTBOX_LEASE_MS - 1,
    )).toEqual([])
    expect(pharmacyPromotionOperationsReady(
      [syncing],
      NOW + PHARMACY_PROMOTION_OUTBOX_LEASE_MS,
    )).toEqual([syncing])
    expect(syncing.operationId).toBe(entry.operationId)
    expect(syncing.clientExecutionId).toBe(entry.clientExecutionId)
    expect(syncing.payloadJson).toBe(entry.payloadJson)
  })

  it("single-flights concurrent flushes and sends all batches sequentially", async () => {
    const entries = Array.from({ length: 101 }, (_, index) => (
      draft(`operation-${String(index).padStart(3, "0")}`, NOW + index)
    ))
    const { store, snapshot } = memoryStore(entries)
    const coordinator = createPharmacyPromotionFlushCoordinator()
    let releaseFirst!: () => void
    let markFirstStarted!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve
    })
    const batchSizes: number[] = []
    let activeRequests = 0
    let maximumActiveRequests = 0

    const send = async (requests: readonly { operationId: string }[]) => {
      batchSizes.push(requests.length)
      activeRequests += 1
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests)
      if (batchSizes.length === 1) {
        markFirstStarted()
        await firstGate
      }
      activeRequests -= 1
      return requests.map((request) => ({
        operationId: request.operationId,
        status: "ok" as const,
      }))
    }

    const first = flushPharmacyPromotionOutbox({ scopeKey: SCOPE_KEY, store, coordinator, send, now: () => NOW + 1_000 })
    const second = flushPharmacyPromotionOutbox({ scopeKey: SCOPE_KEY, store, coordinator, send, now: () => NOW + 1_000 })

    expect(first).toBe(second)
    await firstStarted
    expect(batchSizes).toEqual([100])
    expect(coordinator.isRunning()).toBe(true)

    releaseFirst()
    await expect(first).resolves.toEqual({
      batches: 2,
      attempted: 101,
      accepted: 101,
      errors: 0,
      conflicts: 0,
    })
    expect(batchSizes).toEqual([100, 1])
    expect(maximumActiveRequests).toBe(1)
    expect(snapshot()).toEqual([])
    expect(coordinator.isRunning()).toBe(false)
  })

  it("uses the production draft/submit transport sequentially and classifies retryable failures", async () => {
    const queuedDraft = draft("operation-transport-draft")
    const queuedSubmit = createPharmacyPromotionSubmitOperation({
      clientExecutionId: "execution/server reference",
      expectedVersion: 1,
    }, { scopeKey: SCOPE_KEY, operationId: "operation-transport-submit", now: NOW + 1 })
    const calls: Array<{ url: string; body: unknown }> = []
    let active = 0
    let maximumActive = 0

    const outcomes = await sendPharmacyPromotionOutboxRequests(
      [queuedDraft, queuedSubmit].map((entry) => ({
        operationId: entry.operationId,
        clientExecutionId: entry.clientExecutionId,
        kind: entry.kind,
        payload: pharmacyPromotionOutboxPayload(entry),
      })),
      async (input, init) => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        calls.push({
          url: String(input),
          body: JSON.parse(String(init?.body)),
        })
        await Promise.resolve()
        active -= 1
        if (calls.length === 1) {
          return new Response(JSON.stringify({ success: true, data: { id: "execution-1" } }), {
            status: 201,
            headers: { "content-type": "application/json" },
          })
        }
        return new Response(JSON.stringify({ code: "MTM_PHARMACY_RATE_LIMITED" }), {
          status: 429,
          headers: { "content-type": "application/json" },
        })
      },
    )

    expect(maximumActive).toBe(1)
    expect(calls).toEqual([
      expect.objectContaining({
        url: "/api/v1/mtm/pharmacy-promotion-executions",
        body: expect.objectContaining({ operationId: queuedDraft.operationId }),
      }),
      expect.objectContaining({
        url: "/api/v1/mtm/pharmacy-promotion-executions/execution%2Fserver%20reference/submit",
        body: expect.objectContaining({ operationId: queuedSubmit.operationId }),
      }),
    ])
    expect(outcomes).toEqual([
      expect.objectContaining({ operationId: queuedDraft.operationId, status: "ok" }),
      expect.objectContaining({
        operationId: queuedSubmit.operationId,
        status: "error",
        error: "MTM_PHARMACY_RATE_LIMITED",
      }),
    ])
  })

  it("replays queued binary evidence as multipart with the stable IDs and file", async () => {
    const file = new Blob(["offline proof"], { type: "text/plain" })
    const entry = createPharmacyPromotionEvidenceOperation({
      clientExecutionId: "execution/evidence 1",
      clientEvidenceId: "client-evidence-2",
      clientDocumentId: "client-document-2",
      capturedAt: "2026-08-08T09:00:00.000Z",
      checksumSha256: "b".repeat(64),
      fileName: "offline-proof.txt",
      title: "Offline proof",
      file,
    }, {
      scopeKey: SCOPE_KEY,
      operationId: "operation-evidence-2",
      now: NOW,
    })
    let capturedUrl = ""
    let capturedBody: FormData | null = null

    const outcomes = await sendPharmacyPromotionOutboxRequests(
      [pharmacyPromotionOutboxRequest(entry)],
      async (input, init) => {
        capturedUrl = String(input)
        capturedBody = init?.body as FormData
        return new Response(JSON.stringify({ success: true, data: { id: "evidence-2" } }), {
          status: 201,
          headers: { "content-type": "application/json" },
        })
      },
    )

    expect(capturedUrl).toBe("/api/v1/mtm/pharmacy-promotion-executions/execution%2Fevidence%201/evidence")
    expect(capturedBody).toBeInstanceOf(FormData)
    const submittedBody = capturedBody as unknown as FormData
    expect(submittedBody.get("clientEvidenceId")).toBe("client-evidence-2")
    expect(submittedBody.get("clientDocumentId")).toBe("client-document-2")
    expect(submittedBody.get("operationId")).toBe("operation-evidence-2")
    expect(submittedBody.get("checksumSha256")).toBe("b".repeat(64))
    expect(submittedBody.get("title")).toBe("Offline proof")
    const uploaded = submittedBody.get("file")
    expect(uploaded).toBeInstanceOf(Blob)
    expect((uploaded as Blob).size).toBe(file.size)
    expect(outcomes).toEqual([
      expect.objectContaining({ operationId: "operation-evidence-2", status: "ok" }),
    ])
  })

  it("fails closed without sending when a persisted evidence blob is missing", async () => {
    const entry = createPharmacyPromotionEvidenceOperation({
      clientExecutionId: "execution-evidence-3",
      clientEvidenceId: "client-evidence-3",
      clientDocumentId: "client-document-3",
      capturedAt: "2026-08-08T10:00:00.000Z",
      checksumSha256: "c".repeat(64),
      fileName: "proof.txt",
      file: new Blob(["proof"], { type: "text/plain" }),
    }, {
      scopeKey: SCOPE_KEY,
      operationId: "operation-evidence-3",
      now: NOW,
    })
    const fetcher = async () => {
      throw new Error("transport must not run")
    }

    await expect(sendPharmacyPromotionOutboxRequests([
      { ...pharmacyPromotionOutboxRequest(entry), binary: undefined },
    ], fetcher)).resolves.toEqual([{
      operationId: "operation-evidence-3",
      status: "conflict",
      error: "MTM_PHARMACY_EVIDENCE_BINARY_MISSING",
    }])
  })

  it("retains an operation when a successful HTTP response has an invalid contract", async () => {
    const queuedDraft = draft("operation-invalid-success")
    const outcomes = await sendPharmacyPromotionOutboxRequests([{
      operationId: queuedDraft.operationId,
      clientExecutionId: queuedDraft.clientExecutionId,
      kind: queuedDraft.kind,
      payload: pharmacyPromotionOutboxPayload(queuedDraft),
    }], async () => new Response("<html>login</html>", { status: 200 }))

    expect(outcomes).toEqual([{
      operationId: queuedDraft.operationId,
      status: "error",
      error: "MTM_PHARMACY_SYNC_RESPONSE_INVALID",
      serverData: null,
    }])
  })

  it("treats a missing scoped target or execution as a terminal conflict", async () => {
    const queuedDraft = draft("operation-missing-target")
    const outcomes = await sendPharmacyPromotionOutboxRequests([{
      operationId: queuedDraft.operationId,
      clientExecutionId: queuedDraft.clientExecutionId,
      kind: queuedDraft.kind,
      payload: pharmacyPromotionOutboxPayload(queuedDraft),
    }], async () => new Response(JSON.stringify({ code: "MTM_PHARMACY_TARGET_NOT_FOUND" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    }))

    expect(outcomes).toEqual([expect.objectContaining({
      operationId: queuedDraft.operationId,
      status: "conflict",
      error: "MTM_PHARMACY_TARGET_NOT_FOUND",
    })])
  })

  it("aborts the old session transport before later requests can use rotated cookies", async () => {
    const controller = new AbortController()
    const entries = [draft("operation-session-a"), draft("operation-session-b", NOW + 1)]
    const { store, snapshot } = memoryStore(entries)
    const calls: string[] = []
    const fetcher = async (input: RequestInfo | URL) => {
      calls.push(String(input))
      controller.abort()
      return new Response(JSON.stringify({ success: true, data: { id: "execution-server-1" } }), {
        status: 201,
        headers: { "content-type": "application/json" },
      })
    }

    await expect(flushPharmacyPromotionOutbox({
      scopeKey: SCOPE_KEY,
      store,
      coordinator: createPharmacyPromotionFlushCoordinator(),
      now: () => NOW + 100,
      send: (requests) => sendPharmacyPromotionOutboxRequests(requests, fetcher, {
        signal: controller.signal,
      }),
    })).resolves.toMatchObject({ attempted: 2, accepted: 0, errors: 2, conflicts: 0 })

    expect(calls).toHaveLength(1)
    expect(snapshot()).toEqual([
      expect.objectContaining({ operationId: entries[0].operationId, status: "error" }),
      expect.objectContaining({ operationId: entries[1].operationId, status: "error" }),
    ])
  })

  it("never submits a dependent execution after its offline draft conflicts", async () => {
    const queuedDraft = draft("operation-conflicting-draft", NOW)
    const queuedSubmit = createPharmacyPromotionSubmitOperation({
      clientExecutionId: queuedDraft.clientExecutionId,
      expectedVersion: 1,
    }, {
      scopeKey: SCOPE_KEY,
      operationId: "operation-dependent-submit",
      now: NOW,
    })
    const { store, snapshot } = memoryStore([queuedDraft, queuedSubmit])
    const urls: string[] = []
    const fetcher = async (input: RequestInfo | URL) => {
      urls.push(String(input))
      return new Response(JSON.stringify({
        code: "MTM_PHARMACY_EXECUTION_IDEMPOTENCY_CONFLICT",
      }), {
        status: 409,
        headers: { "content-type": "application/json" },
      })
    }

    await expect(flushPharmacyPromotionOutbox({
      scopeKey: SCOPE_KEY,
      store,
      batchSize: 1,
      now: () => NOW,
      send: (requests) => sendPharmacyPromotionOutboxRequests(requests, fetcher),
    })).resolves.toEqual({
      batches: 1,
      attempted: 1,
      accepted: 0,
      errors: 0,
      conflicts: 2,
    })

    expect(urls).toEqual(["/api/v1/mtm/pharmacy-promotion-executions"])
    expect(snapshot()).toEqual([
      expect.objectContaining({
        operationId: queuedDraft.operationId,
        status: "conflict",
        lastError: "MTM_PHARMACY_EXECUTION_IDEMPOTENCY_CONFLICT",
      }),
      expect.objectContaining({
        operationId: queuedSubmit.operationId,
        status: "conflict",
        lastError: "MTM_PHARMACY_SYNC_DRAFT_CONFLICT",
      }),
    ])
  })
})
