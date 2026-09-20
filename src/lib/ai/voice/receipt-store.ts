/**
 * Client-side receipt store for the voice action-intent UI (roadmap U1.1).
 *
 * SHADOW MODE. This module deliberately has no way to write anything. It reads
 * the caller's one active receipt and holds it for rendering; committing stays
 * behind an explicit button that a later slice (U1.8) wires to
 * `POST /api/v1/ai/voice/actions/:id/commit`. `assertNoVoiceReceiptWriteApi`
 * below is the executable form of that promise, and a test calls it.
 *
 * Why a store bound to ONE voice session id, rather than a plain useState:
 *
 * - A receipt names a CRM mutation that has not happened yet. If a stale
 *   receipt from a previous session survived a reconnect, the user would be
 *   reviewing one draft and later confirming another. So the session id is a
 *   constructor argument, not a field of the data: every `adopt` compares the
 *   server's `voiceSessionId` against it and drops a mismatch instead of
 *   rendering it. A new session gets a new store.
 * - The server is the only authority on what exists. This store never invents,
 *   merges or patches a receipt; it accepts a server payload whole or not at
 *   all, which is why `normalizeVoiceReceipt` returns null instead of a
 *   partially repaired object.
 */

/** Whether the receipt UI may commit. Stays false until roadmap U1.8. */
export const VOICE_RECEIPT_COMMIT_ENABLED = false as const

/**
 * States in which a receipt is still the user's open decision. A terminal
 * receipt (succeeded/failed/cancelled/expired/stale) is not a pending action
 * and is not shown by this slice; U1.11 adds the terminal presentation.
 */
export const VOICE_RECEIPT_OPEN_STATES = [
  "collecting",
  "awaiting_confirmation",
  "executing",
] as const

export type VoiceReceiptState = (typeof VOICE_RECEIPT_OPEN_STATES)[number]

const OPEN_STATE_SET = new Set<string>(VOICE_RECEIPT_OPEN_STATES)

export type VoiceReceiptField = Readonly<{
  key: string
  labelKey: string
  before?: unknown
  after: unknown
}>

export type VoiceReceiptPreview = Readonly<{
  contract: 1
  actionType: string
  operation: string
  entityType: string
  titleKey: string
  target?: Readonly<{ entityType: string; id: string; label: string }>
  fields: readonly VoiceReceiptField[]
}>

export type VoiceReceiptWarning = Readonly<{
  code: string
  [key: string]: unknown
}>

export type VoiceReceipt = Readonly<{
  id: string
  voiceSessionId: string
  actionType: string
  state: VoiceReceiptState
  revision: number
  payloadHash: string
  preview: VoiceReceiptPreview | null
  warnings: readonly VoiceReceiptWarning[]
  target: Readonly<{ entityType: string; id: string }> | null
  expiresAtMs: number
}>

export type VoiceReceiptRejectionReason =
  | "malformed"
  | "foreign_session"
  | "terminal_state"

export type VoiceReceiptStatus = "idle" | "loading" | "ready" | "error"

export type VoiceReceiptStoreState = Readonly<{
  voiceSessionId: string
  status: VoiceReceiptStatus
  receipt: VoiceReceipt | null
  /** The user closed the surface locally. The server draft is untouched. */
  dismissed: boolean
  errorCode: string | null
  lastRejection: VoiceReceiptRejectionReason | null
}>

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key]
  return typeof value === "string" && value.length > 0 ? value : null
}

function normalizePreview(value: unknown): VoiceReceiptPreview | null {
  if (!isPlainObject(value)) return null
  if (value.contract !== 1) return null

  const actionType = readString(value, "actionType")
  const operation = readString(value, "operation")
  const entityType = readString(value, "entityType")
  const titleKey = readString(value, "titleKey")
  if (!actionType || !operation || !entityType || !titleKey) return null
  if (!Array.isArray(value.fields)) return null

  const fields: VoiceReceiptField[] = []
  for (const raw of value.fields) {
    if (!isPlainObject(raw)) return null
    const key = readString(raw, "key")
    const labelKey = readString(raw, "labelKey")
    if (!key || !labelKey) return null
    fields.push(
      Object.prototype.hasOwnProperty.call(raw, "before")
        ? { key, labelKey, before: raw.before, after: raw.after }
        : { key, labelKey, after: raw.after },
    )
  }

  let target: VoiceReceiptPreview["target"]
  if (value.target !== undefined) {
    if (!isPlainObject(value.target)) return null
    const entity = readString(value.target, "entityType")
    const id = readString(value.target, "id")
    const label = readString(value.target, "label")
    if (!entity || !id || label === null) return null
    target = { entityType: entity, id, label }
  }

  return { contract: 1, actionType, operation, entityType, titleKey, target, fields }
}

function normalizeWarnings(value: unknown): readonly VoiceReceiptWarning[] {
  if (!Array.isArray(value)) return []
  const warnings: VoiceReceiptWarning[] = []
  for (const raw of value) {
    if (!isPlainObject(raw)) continue
    const code = readString(raw, "code")
    if (!code) continue
    warnings.push({ ...raw, code })
  }
  return warnings
}

export type VoiceReceiptNormalizationResult =
  | Readonly<{ ok: true; receipt: VoiceReceipt }>
  | Readonly<{ ok: false; reason: VoiceReceiptRejectionReason }>

/**
 * Turn one `/api/v1/ai/voice/actions/...` payload into a renderable receipt,
 * or say precisely why it is not one. Session binding is checked here rather
 * than in the component so the rule cannot be forgotten at a call site.
 */
export function normalizeVoiceReceipt(
  raw: unknown,
  expectedVoiceSessionId: string,
): VoiceReceiptNormalizationResult {
  if (!isPlainObject(raw)) return { ok: false, reason: "malformed" }

  const id = readString(raw, "id")
  const voiceSessionId = readString(raw, "voiceSessionId")
  const actionType = readString(raw, "actionType")
  const state = readString(raw, "state")
  const payloadHash = readString(raw, "payloadHash")
  const expiresAt = readString(raw, "expiresAt")
  const revision = raw.revision

  if (
    !id
    || !voiceSessionId
    || !actionType
    || !state
    || !payloadHash
    || !expiresAt
    || !Number.isSafeInteger(revision)
    || (revision as number) < 1
  ) {
    return { ok: false, reason: "malformed" }
  }

  const expiresAtMs = Date.parse(expiresAt)
  if (!Number.isFinite(expiresAtMs)) return { ok: false, reason: "malformed" }

  // Session binding before state: a foreign receipt is a correctness problem,
  // and naming it as such keeps the two rejections distinguishable in tests
  // and telemetry.
  if (voiceSessionId !== expectedVoiceSessionId) {
    return { ok: false, reason: "foreign_session" }
  }
  if (!OPEN_STATE_SET.has(state)) return { ok: false, reason: "terminal_state" }

  let target: VoiceReceipt["target"] = null
  if (raw.target !== null && raw.target !== undefined) {
    if (!isPlainObject(raw.target)) return { ok: false, reason: "malformed" }
    const entityType = readString(raw.target, "entityType")
    const targetId = readString(raw.target, "id")
    if (!entityType || !targetId) return { ok: false, reason: "malformed" }
    target = { entityType, id: targetId }
  }

  return {
    ok: true,
    receipt: {
      id,
      voiceSessionId,
      actionType,
      state: state as VoiceReceiptState,
      revision: revision as number,
      payloadHash,
      preview: normalizePreview(raw.preview),
      warnings: normalizeWarnings(raw.warnings),
      target,
      expiresAtMs,
    },
  }
}

export type VoiceReceiptStore = Readonly<{
  voiceSessionId: string
  getState: () => VoiceReceiptStoreState
  subscribe: (listener: () => void) => () => void
  /** Mark a load in flight. Keeps any receipt already on screen. */
  beginLoad: () => void
  /** Accept a server payload, or reject it and say why. */
  adopt: (raw: unknown) => VoiceReceiptNormalizationResult
  /** Record that the active-receipt read failed. */
  fail: (errorCode: string) => void
  /** No active receipt exists for this session. */
  clearReceipt: () => void
  /** Close the surface locally only — the server draft keeps its own TTL. */
  dismiss: () => void
  /** Reopen a locally dismissed surface. */
  reveal: () => void
  /** Drop a receipt whose server TTL has passed. */
  pruneExpired: (nowMs: number) => boolean
}>

export function createVoiceReceiptStore(voiceSessionId: string): VoiceReceiptStore {
  if (typeof voiceSessionId !== "string" || voiceSessionId.length === 0) {
    throw new Error("A voice receipt store requires the authenticated voice session id")
  }

  let state: VoiceReceiptStoreState = {
    voiceSessionId,
    status: "idle",
    receipt: null,
    dismissed: false,
    errorCode: null,
    lastRejection: null,
  }
  const listeners = new Set<() => void>()

  const set = (next: Partial<VoiceReceiptStoreState>): void => {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
  }

  return {
    voiceSessionId,
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    beginLoad: () => set({ status: "loading", errorCode: null }),
    adopt: (raw) => {
      const result = normalizeVoiceReceipt(raw, voiceSessionId)
      if (!result.ok) {
        // A rejected payload must never leave a half-adopted receipt behind.
        set({ status: "ready", receipt: null, errorCode: null, lastRejection: result.reason })
        return result
      }
      const sameReceipt = state.receipt?.id === result.receipt.id
      set({
        status: "ready",
        receipt: result.receipt,
        errorCode: null,
        lastRejection: null,
        // A genuinely new receipt reopens the surface; a refresh of the one the
        // user just closed does not reopen itself.
        dismissed: sameReceipt ? state.dismissed : false,
      })
      return result
    },
    fail: (errorCode) => set({ status: "error", errorCode }),
    clearReceipt: () => set({ status: "ready", receipt: null, errorCode: null, lastRejection: null }),
    dismiss: () => set({ dismissed: true }),
    reveal: () => set({ dismissed: false }),
    pruneExpired: (nowMs) => {
      if (!state.receipt || state.receipt.expiresAtMs > nowMs) return false
      set({ receipt: null, lastRejection: null })
      return true
    },
  }
}

/**
 * Read the caller's one active receipt for this voice session.
 *
 * Same-origin with the browser session cookie, exactly like every other voice
 * client tool: the server decides who is asking. GET only — this function is
 * the store's entire network surface.
 */
export async function fetchActiveVoiceReceipt(
  voiceSessionId: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const url = `/api/v1/ai/voice/actions/active?voiceSessionId=${encodeURIComponent(voiceSessionId)}`
  const response = await fetch(url, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal,
  })
  if (!response.ok) {
    const error = new Error(`Active voice receipt read failed with ${response.status}`) as Error & {
      status?: number
    }
    error.status = response.status
    throw error
  }
  const body = (await response.json()) as unknown
  if (!isPlainObject(body)) return null
  return body.data ?? null
}

/**
 * Executable shadow-mode guarantee (roadmap U1 exit gate: "the model has no
 * commit capability", "a write is impossible without the receipt and explicit
 * button press"). A test calls this so that adding `store.commit()` in a later
 * edit fails the suite instead of silently shipping a hidden write path.
 */
export function assertNoVoiceReceiptWriteApi(store: VoiceReceiptStore): void {
  const forbidden = /commit|confirm|execute|write|mutate|submit|send/i
  const offenders = Object.keys(store).filter((key) => forbidden.test(key))
  if (offenders.length > 0) {
    throw new Error(
      `Voice receipt store exposes a write-shaped method in shadow mode: ${offenders.join(", ")}`,
    )
  }
  if (VOICE_RECEIPT_COMMIT_ENABLED) {
    throw new Error("Voice receipt commit must stay disabled until roadmap U1.8")
  }
}
