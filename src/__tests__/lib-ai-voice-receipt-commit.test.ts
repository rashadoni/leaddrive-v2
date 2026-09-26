import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  cancelVoiceReceipt,
  commitVoiceReceipt,
  voiceResultHref,
} from "@/lib/ai/voice/receipt-commit"

const INTENT = "intent-1"
const HASH = "a".repeat(64)

const fetchMock = vi.fn()

type Call = [string, RequestInit]

function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name] ?? null },
    json: () => Promise.resolve(body),
  })
}

const proof = {
  success: true,
  data: {
    confirmationEventId: "event-1",
    confirmationToken: "t".repeat(43),
    intentId: INTENT,
    revision: 1,
    payloadHash: HASH,
    expiresAt: "2026-09-20T12:01:00.000Z",
  },
}

const committed = {
  success: true,
  data: {
    intentId: INTENT,
    state: "succeeded",
    actionType: "create_task",
    revision: 1,
    payloadHash: HASH,
    result: { entityType: "task", entityId: "task-9" },
    replayed: false,
  },
}

function commit() {
  return commitVoiceReceipt({ intentId: INTENT, revision: 1, payloadHash: HASH })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("confirm and commit one receipt", () => {
  it("confirms first, then commits with that exact proof", async () => {
    fetchMock
      .mockReturnValueOnce(response(201, proof))
      .mockReturnValueOnce(response(200, committed))

    const outcome = await commit()

    expect(outcome).toEqual({
      kind: "succeeded",
      entityType: "task",
      entityId: "task-9",
      replayed: false,
    })

    const calls = fetchMock.mock.calls as Call[]
    expect(calls).toHaveLength(2)
    expect(calls[0][0]).toBe(`/api/v1/ai/voice/actions/${INTENT}/confirmation`)
    expect(calls[1][0]).toBe(`/api/v1/ai/voice/actions/${INTENT}/commit`)

    for (const [, init] of calls) {
      expect(init.method).toBe("POST")
      expect(init.credentials).toBe("same-origin")
      // The server rejects a bearer caller outright; the browser session is
      // the only identity this path may carry.
      expect(init.headers).toEqual({ "Content-Type": "application/json" })
    }

    expect(JSON.parse(String(calls[0][1].body))).toEqual({
      expectedRevision: 1,
      payloadHash: HASH,
      confirmed: true,
    })
    expect(JSON.parse(String(calls[1][1].body))).toEqual({
      confirmationEventId: "event-1",
      confirmationToken: "t".repeat(43),
      expectedRevision: 1,
      payloadHash: HASH,
    })
  })

  it("sends the reviewed revision and hash untouched", async () => {
    fetchMock
      .mockReturnValueOnce(response(201, proof))
      .mockReturnValueOnce(response(200, committed))

    await commitVoiceReceipt({ intentId: INTENT, revision: 7, payloadHash: "b".repeat(64) })

    const [, init] = fetchMock.mock.calls[0] as Call
    expect(JSON.parse(String(init.body))).toMatchObject({
      expectedRevision: 7,
      payloadHash: "b".repeat(64),
    })
  })

  it("reports a replayed commit as already done", async () => {
    fetchMock
      .mockReturnValueOnce(response(201, proof))
      .mockReturnValueOnce(response(200, { ...committed, data: { ...committed.data, replayed: true } }))

    await expect(commit()).resolves.toMatchObject({ kind: "succeeded", replayed: true })
  })

  it("never commits when the confirmation is refused", async () => {
    fetchMock.mockReturnValueOnce(response(409, { code: "INTENT_REVISION_MISMATCH" }))

    await expect(commit()).resolves.toEqual({ kind: "stale", code: "INTENT_REVISION_MISMATCH" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((fetchMock.mock.calls[0] as Call)[0]).not.toMatch(/\/commit$/)
  })

  it("classifies each failure by what the user can do next", async () => {
    const cases: Array<[number, unknown, Record<string, string>, unknown]> = [
      [403, { code: "MODULE_FORBIDDEN" }, {}, { kind: "forbidden", code: "MODULE_FORBIDDEN" }],
      [404, { code: "INTENT_NOT_FOUND" }, {}, { kind: "stale", code: "INTENT_NOT_FOUND" }],
      [409, { code: "CONFIRMATION_ALREADY_USED" }, {}, { kind: "stale", code: "CONFIRMATION_ALREADY_USED" }],
      [429, { code: "RATE_LIMITED" }, { "Retry-After": "30" }, { kind: "rate_limited", retryAfterSeconds: 30 }],
      [503, { code: "COMMIT_RETRY_REQUIRED" }, {}, { kind: "retriable", code: "COMMIT_RETRY_REQUIRED" }],
      [400, { code: "LEAD_INVALID", error: "Phone is not valid" }, {}, {
        kind: "failed",
        code: "LEAD_INVALID",
        message: "Phone is not valid",
      }],
    ]

    for (const [status, body, headers, expected] of cases) {
      fetchMock.mockReset()
      fetchMock.mockReturnValueOnce(response(status, body, headers))
      await expect(commit()).resolves.toEqual(expected)
    }
  })

  // A 5xx after the commit request means the mutation may have run. Calling it
  // a failure would push the user to repeat a completed write.
  it("treats a server error during commit as retriable, not failed", async () => {
    fetchMock
      .mockReturnValueOnce(response(201, proof))
      .mockReturnValueOnce(response(500, { error: "boom" }))

    await expect(commit()).resolves.toMatchObject({ kind: "retriable" })
  })

  it("does not claim success when the server returns an unusable result", async () => {
    fetchMock
      .mockReturnValueOnce(response(201, proof))
      .mockReturnValueOnce(response(200, { success: true, data: { result: { entityType: "task" } } }))

    await expect(commit()).resolves.toEqual({ kind: "retriable", code: "RESULT_MALFORMED" })
  })

  it("does not commit on a malformed confirmation", async () => {
    fetchMock.mockReturnValueOnce(response(201, { success: true, data: { confirmationEventId: "e" } }))

    await expect(commit()).resolves.toEqual({ kind: "retriable", code: "CONFIRMATION_MALFORMED" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("defaults the retry delay when the server sends no Retry-After", async () => {
    fetchMock.mockReturnValueOnce(response(429, { code: "RATE_LIMITED" }))
    await expect(commit()).resolves.toEqual({ kind: "rate_limited", retryAfterSeconds: 60 })
  })
})

describe("cancel a receipt", () => {
  it("posts the expected revision to the cancel route only", async () => {
    fetchMock.mockReturnValueOnce(response(200, { success: true }))

    await expect(cancelVoiceReceipt({ intentId: INTENT, revision: 3 })).resolves.toEqual({ ok: true })

    const [url, init] = fetchMock.mock.calls[0] as Call
    expect(url).toBe(`/api/v1/ai/voice/actions/${INTENT}/cancel`)
    expect(JSON.parse(String(init.body))).toEqual({ expectedRevision: 3 })
    expect(url).not.toMatch(/commit|confirmation/)
  })

  it("treats an already-gone draft as cancelled", async () => {
    fetchMock.mockReturnValueOnce(response(404, { code: "INTENT_NOT_FOUND" }))
    await expect(cancelVoiceReceipt({ intentId: INTENT, revision: 1 })).resolves.toEqual({ ok: true })
  })

  it("reports a refused cancel", async () => {
    fetchMock.mockReturnValueOnce(response(409, { code: "INTENT_NOT_CANCELLABLE" }))
    await expect(cancelVoiceReceipt({ intentId: INTENT, revision: 1 }))
      .resolves.toEqual({ ok: false, code: "INTENT_NOT_CANCELLABLE" })
  })
})

describe("result links", () => {
  it("points at the record the action produced", () => {
    expect(voiceResultHref("task", "task-9")).toBe("/tasks/task-9")
    expect(voiceResultHref("lead", "lead-9")).toBe("/leads/lead-9")
    expect(voiceResultHref("deal", "deal-9")).toBe("/deals/deal-9")
  })

  it("escapes an id rather than building a path out of it", () => {
    expect(voiceResultHref("lead", "a/b?c")).toBe("/leads/a%2Fb%3Fc")
  })
})
