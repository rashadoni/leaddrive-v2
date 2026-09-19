import { createHash } from "node:crypto"

export const AI_ACTION_INTENT_STATES = [
  "collecting",
  "awaiting_confirmation",
  "executing",
  "succeeded",
  "failed",
  "cancelled",
  "expired",
  "stale",
] as const

export type AiActionIntentState = (typeof AI_ACTION_INTENT_STATES)[number]

export const AI_ACTION_INTENT_ACTIVE_STATES = [
  "collecting",
  "awaiting_confirmation",
  "executing",
] as const satisfies readonly AiActionIntentState[]

export const AI_ACTION_INTENT_TERMINAL_STATES = [
  "succeeded",
  "failed",
  "cancelled",
  "expired",
  "stale",
] as const satisfies readonly AiActionIntentState[]

export const DEFAULT_AI_ACTION_INTENT_TTL_MS = 10 * 60 * 1000

const TRANSITIONS: Readonly<Record<AiActionIntentState, readonly AiActionIntentState[]>> = {
  collecting: ["awaiting_confirmation", "cancelled", "expired"],
  awaiting_confirmation: ["collecting", "executing", "cancelled", "expired", "stale"],
  executing: ["succeeded", "failed", "stale"],
  succeeded: [],
  failed: [],
  cancelled: [],
  expired: [],
  stale: [],
}

const STATE_SET = new Set<string>(AI_ACTION_INTENT_STATES)
const ACTIVE_STATE_SET = new Set<string>(AI_ACTION_INTENT_ACTIVE_STATES)
const TERMINAL_STATE_SET = new Set<string>(AI_ACTION_INTENT_TERMINAL_STATES)

export function isAiActionIntentState(value: unknown): value is AiActionIntentState {
  return typeof value === "string" && STATE_SET.has(value)
}

export function isActiveAiActionIntentState(state: AiActionIntentState): boolean {
  return ACTIVE_STATE_SET.has(state)
}

export function isTerminalAiActionIntentState(state: AiActionIntentState): boolean {
  return TERMINAL_STATE_SET.has(state)
}

export function canTransitionAiActionIntent(
  from: AiActionIntentState,
  to: AiActionIntentState,
): boolean {
  return TRANSITIONS[from].includes(to)
}

export function assertAiActionIntentTransition(
  from: AiActionIntentState,
  to: AiActionIntentState,
): void {
  if (!canTransitionAiActionIntent(from, to)) {
    throw new Error(`Illegal AI action-intent transition: ${from} -> ${to}`)
  }
}

export function aiActionIntentExpiresAt(
  now: Date,
  ttlMs: number = DEFAULT_AI_ACTION_INTENT_TTL_MS,
): Date {
  if (!Number.isFinite(now.getTime())) {
    throw new Error("AI action-intent creation time must be a valid Date")
  }
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new Error("AI action-intent TTL must be a positive integer number of milliseconds")
  }
  return new Date(now.getTime() + ttlMs)
}

/**
 * Canonical JSON used only for deterministic action-intent hashing. Objects
 * are key-sorted recursively; array order remains meaningful. Non-JSON input
 * is rejected instead of being silently dropped by JSON.stringify.
 */
export function canonicalizeAiActionIntentJson(value: unknown): string {
  if (value === null) return "null"

  switch (typeof value) {
    case "boolean":
    case "string":
      return JSON.stringify(value)
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error("AI action-intent payload contains a non-finite number")
      }
      return JSON.stringify(value)
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalizeAiActionIntentJson(item)).join(",")}]`
      }

      const prototype = Object.getPrototypeOf(value)
      if (prototype !== Object.prototype && prototype !== null) {
        throw new Error("AI action-intent payload must contain only plain JSON objects")
      }

      const entries = Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => {
          if (item === undefined) {
            throw new Error("AI action-intent payload cannot contain undefined")
          }
          return `${JSON.stringify(key)}:${canonicalizeAiActionIntentJson(item)}`
        })
      return `{${entries.join(",")}}`
    }
    default:
      throw new Error(`AI action-intent payload contains unsupported ${typeof value}`)
  }
}

/**
 * Binds the action type, revision and normalized payload together. The domain
 * prefix makes the digest explicit and leaves room for a future v2 algorithm.
 */
export function hashAiActionIntentPayload(input: {
  actionType: string
  revision: number
  normalizedPayload: unknown
}): string {
  const actionType = input.actionType.trim()
  if (!actionType) throw new Error("AI action-intent actionType is required")
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) {
    throw new Error("AI action-intent revision must be a positive integer")
  }

  const canonical = canonicalizeAiActionIntentJson({
    actionType,
    normalizedPayload: input.normalizedPayload,
    revision: input.revision,
  })

  return createHash("sha256")
    .update("leaddrive:ai-action-intent-payload:v1\n", "utf8")
    .update(canonical, "utf8")
    .digest("hex")
}
