import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  assertNoVoiceReceiptWriteApi,
  createVoiceReceiptStore,
  fetchActiveVoiceReceipt,
  normalizeVoiceReceipt,
  VOICE_RECEIPT_COMMIT_ENABLED,
} from "@/lib/ai/voice/receipt-store"

const SESSION = "voice-session-1"

function serverReceipt(overrides: Record<string, unknown> = {}) {
  return {
    id: "intent-1",
    voiceSessionId: SESSION,
    actionType: "create_lead",
    state: "awaiting_confirmation",
    revision: 1,
    payloadHash: "a".repeat(64),
    preview: {
      contract: 1,
      actionType: "create_lead",
      operation: "create",
      entityType: "lead",
      titleKey: "voice.receipt.action.create_lead",
      fields: [
        { key: "contactName", labelKey: "leads.contactName", after: "Ali Mammadov" },
        { key: "phone", labelKey: "leads.phone", after: "+994 50 123 45 67" },
      ],
    },
    warnings: [{ code: "possible_duplicate_lead", leadId: "lead-9" }],
    target: null,
    expiresAt: "2026-09-20T12:10:00.000Z",
    createdAt: "2026-09-20T12:00:00.000Z",
    updatedAt: "2026-09-20T12:00:00.000Z",
    replayed: false,
    ...overrides,
  }
}

describe("voice receipt normalization", () => {
  it("accepts a receipt issued for the current voice session", () => {
    const result = normalizeVoiceReceipt(serverReceipt(), SESSION)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.receipt.id).toBe("intent-1")
    expect(result.receipt.state).toBe("awaiting_confirmation")
    expect(result.receipt.preview?.fields).toHaveLength(2)
    expect(result.receipt.warnings.map((w) => w.code)).toEqual(["possible_duplicate_lead"])
    expect(result.receipt.expiresAtMs).toBe(Date.parse("2026-09-20T12:10:00.000Z"))
  })

  it("rejects a receipt that belongs to another voice session", () => {
    const result = normalizeVoiceReceipt(
      serverReceipt({ voiceSessionId: "voice-session-2" }),
      SESSION,
    )
    expect(result).toEqual({ ok: false, reason: "foreign_session" })
  })

  it("rejects terminal receipts, which are no longer an open decision", () => {
    for (const state of ["succeeded", "failed", "cancelled", "expired", "stale"]) {
      expect(normalizeVoiceReceipt(serverReceipt({ state }), SESSION)).toEqual({
        ok: false,
        reason: "terminal_state",
      })
    }
  })

  it("rejects malformed payloads instead of repairing them", () => {
    const malformed: unknown[] = [
      null,
      "intent-1",
      [],
      serverReceipt({ id: "" }),
      serverReceipt({ revision: 0 }),
      serverReceipt({ revision: 1.5 }),
      serverReceipt({ expiresAt: "not-a-date" }),
      serverReceipt({ target: { entityType: "lead" } }),
    ]
    for (const payload of malformed) {
      expect(normalizeVoiceReceipt(payload, SESSION)).toEqual({ ok: false, reason: "malformed" })
    }
  })

  it("drops an unusable preview rather than the whole receipt", () => {
    const result = normalizeVoiceReceipt(serverReceipt({ preview: { contract: 2 } }), SESSION)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.receipt.preview).toBeNull()
  })

  it("keeps an update target so a later diff can be anchored to it", () => {
    const result = normalizeVoiceReceipt(
      serverReceipt({
        actionType: "update_lead",
        target: { entityType: "lead", id: "lead-3" },
      }),
      SESSION,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.receipt.target).toEqual({ entityType: "lead", id: "lead-3" })
  })
})

describe("voice receipt store", () => {
  it("requires the authenticated voice session id", () => {
    expect(() => createVoiceReceiptStore("")).toThrow(/voice session id/i)
  })

  it("adopts a matching receipt and notifies subscribers", () => {
    const store = createVoiceReceiptStore(SESSION)
    const listener = vi.fn()
    store.subscribe(listener)

    store.beginLoad()
    expect(store.getState().status).toBe("loading")

    const result = store.adopt(serverReceipt())
    expect(result.ok).toBe(true)
    expect(store.getState().status).toBe("ready")
    expect(store.getState().receipt?.id).toBe("intent-1")
    expect(listener).toHaveBeenCalled()
  })

  it("never holds a receipt from another voice session", () => {
    const store = createVoiceReceiptStore(SESSION)
    const result = store.adopt(serverReceipt({ voiceSessionId: "voice-session-2" }))
    expect(result).toEqual({ ok: false, reason: "foreign_session" })
    expect(store.getState().receipt).toBeNull()
    expect(store.getState().lastRejection).toBe("foreign_session")
  })

  it("does not leave a stale receipt behind when a later payload is rejected", () => {
    const store = createVoiceReceiptStore(SESSION)
    store.adopt(serverReceipt())
    expect(store.getState().receipt).not.toBeNull()

    store.adopt(serverReceipt({ voiceSessionId: "voice-session-2" }))
    expect(store.getState().receipt).toBeNull()
  })

  it("keeps a dismissal across a refresh of the same receipt, and drops it for a new one", () => {
    const store = createVoiceReceiptStore(SESSION)
    store.adopt(serverReceipt())
    store.dismiss()
    expect(store.getState().dismissed).toBe(true)

    store.adopt(serverReceipt({ revision: 2 }))
    expect(store.getState().dismissed).toBe(true)

    store.adopt(serverReceipt({ id: "intent-2" }))
    expect(store.getState().dismissed).toBe(false)
  })

  it("reveals a dismissed surface on request", () => {
    const store = createVoiceReceiptStore(SESSION)
    store.adopt(serverReceipt())
    store.dismiss()
    store.reveal()
    expect(store.getState().dismissed).toBe(false)
  })

  it("prunes a receipt once its server TTL has passed", () => {
    const store = createVoiceReceiptStore(SESSION)
    store.adopt(serverReceipt())
    const expiry = Date.parse("2026-09-20T12:10:00.000Z")

    expect(store.pruneExpired(expiry - 1)).toBe(false)
    expect(store.getState().receipt).not.toBeNull()

    expect(store.pruneExpired(expiry)).toBe(true)
    expect(store.getState().receipt).toBeNull()
    expect(store.pruneExpired(expiry + 1)).toBe(false)
  })

  it("records a failed read without inventing a receipt", () => {
    const store = createVoiceReceiptStore(SESSION)
    store.fail("http_403")
    expect(store.getState()).toMatchObject({ status: "error", errorCode: "http_403", receipt: null })
  })

  it("stops notifying an unsubscribed listener", () => {
    const store = createVoiceReceiptStore(SESSION)
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    unsubscribe()
    store.beginLoad()
    expect(listener).not.toHaveBeenCalled()
  })

  // Shadow mode is the point of this slice: the store must have no way to
  // write, so that the only future path to a CRM mutation is the explicit
  // button of roadmap U1.8.
  it("exposes no commit, confirm or execute capability", () => {
    const store = createVoiceReceiptStore(SESSION)
    expect(VOICE_RECEIPT_COMMIT_ENABLED).toBe(false)
    expect(() => assertNoVoiceReceiptWriteApi(store)).not.toThrow()
    expect(Object.keys(store).sort()).toEqual([
      "adopt",
      "beginLoad",
      "clearReceipt",
      "dismiss",
      "fail",
      "getState",
      "pruneExpired",
      "reveal",
      "subscribe",
      "voiceSessionId",
    ])
  })

  it("fails the guard if a write-shaped method is ever added", () => {
    const store = createVoiceReceiptStore(SESSION)
    const tampered = { ...store, commit: () => {} } as unknown as typeof store
    expect(() => assertNoVoiceReceiptWriteApi(tampered)).toThrow(/write-shaped/i)
  })
})

describe("active receipt read", () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("reads the active receipt over a same-origin GET", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: serverReceipt() }),
    })

    const data = await fetchActiveVoiceReceipt("session/with space")

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/v1/ai/voice/actions/active?voiceSessionId=session%2Fwith%20space")
    expect(init.method).toBe("GET")
    expect(init.credentials).toBe("same-origin")
    expect(init.body).toBeUndefined()
    expect(data).toMatchObject({ id: "intent-1" })
  })

  it("returns null when the session has no active receipt", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, data: null }) })
    await expect(fetchActiveVoiceReceipt(SESSION)).resolves.toBeNull()
  })

  it("surfaces the HTTP status so the caller can distinguish forbidden from offline", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) })
    await expect(fetchActiveVoiceReceipt(SESSION)).rejects.toMatchObject({ status: 403 })
  })

  it("never touches a commit, draft or cancel route", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, data: null }) })
    await fetchActiveVoiceReceipt(SESSION)
    for (const [url, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      expect(url).not.toMatch(/commit|confirmation|cancel|draft/)
      expect(init.method ?? "GET").toBe("GET")
    }
  })
})
