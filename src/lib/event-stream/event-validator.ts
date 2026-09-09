/**
 * G6 event validator — slice-1 pure helper.
 *
 * Light shape-check against PayloadSchema. Slice-2 swaps in ajv (full
 * draft-07 JSON-Schema). This file does enough to catch obviously-bad
 * publisher input early without a heavy dep.
 *
 * Returns a structured result so the publish API can surface a useful
 * error to clients (HTTP 422 + missing-field list).
 */

import type {
  PayloadFieldSchema,
  PayloadSchema,
  PublishEventInput,
} from "./types"
import {
  STREAM_STATUS_TRANSITIONS,
  SUBSCRIPTION_STATUS_TRANSITIONS,
  DEAD_LETTER_TRIAGE_TRANSITIONS,
  type StreamStatus,
  type SubscriptionStatus,
  type DeadLetterTriageStatus,
} from "./types"

export interface ValidationOk {
  ok: true
}

export interface ValidationError {
  ok: false
  /** Machine-readable error code (HTTP 422 mapping). */
  code:
    | "missing_required_fields"
    | "invalid_field_type"
    | "invalid_enum_value"
    | "missing_event_type"
    | "missing_payload"
    | "invalid_idempotency_key"
  /** Human-readable message. */
  message: string
  /** Field paths that failed (if applicable). */
  fields?: string[]
}

export type ValidationResult = ValidationOk | ValidationError

const OK: ValidationOk = { ok: true }

/**
 * Validate a publish input against the stream's declared payload schema.
 *
 * Slice-1 checks:
 *   1. `eventType` non-empty string.
 *   2. `payload` is a plain object (not null / array).
 *   3. `idempotencyKey` (if set) is a non-empty string ≤ 200 chars.
 *   4. Required fields from schema.required[] present in payload.
 *   5. Type-tag matches per schema.properties[field].type.
 *   6. Enum constraint satisfied per schema.properties[field].enum.
 *
 * Slice-2 will replace this with ajv against the full payloadSchema JSON.
 */
export function validatePublishEvent(
  input: PublishEventInput,
  schema: PayloadSchema,
): ValidationResult {
  // 1. eventType
  if (typeof input.eventType !== "string" || input.eventType.trim() === "") {
    return {
      ok: false,
      code: "missing_event_type",
      message: "eventType is required and must be a non-empty string",
    }
  }
  // 2. payload object
  if (
    input.payload === null ||
    typeof input.payload !== "object" ||
    Array.isArray(input.payload)
  ) {
    return {
      ok: false,
      code: "missing_payload",
      message: "payload must be a plain object",
    }
  }
  // 3. idempotencyKey
  if (input.idempotencyKey !== undefined && input.idempotencyKey !== null) {
    if (
      typeof input.idempotencyKey !== "string" ||
      input.idempotencyKey.trim() === "" ||
      input.idempotencyKey.length > 200
    ) {
      return {
        ok: false,
        code: "invalid_idempotency_key",
        message:
          "idempotencyKey must be a non-empty string up to 200 characters",
      }
    }
  }
  // 4. Required fields
  if (schema.required && schema.required.length > 0) {
    const missing: string[] = []
    for (const key of schema.required) {
      if (!(key in input.payload)) {
        missing.push(key)
      }
    }
    if (missing.length > 0) {
      return {
        ok: false,
        code: "missing_required_fields",
        message: `payload missing required fields: ${missing.join(", ")}`,
        fields: missing,
      }
    }
  }
  // 5 + 6. Type + enum checks
  if (schema.properties) {
    for (const [key, fieldSchema] of Object.entries(schema.properties)) {
      if (!(key in input.payload)) continue // not required → skip
      const value = (input.payload as Record<string, unknown>)[key]
      const typeFail = checkFieldType(value, fieldSchema)
      if (typeFail !== null) {
        return {
          ok: false,
          code: "invalid_field_type",
          message: `payload.${key}: ${typeFail}`,
          fields: [key],
        }
      }
      const enumFail = checkEnum(value, fieldSchema)
      if (enumFail !== null) {
        return {
          ok: false,
          code: "invalid_enum_value",
          message: `payload.${key}: ${enumFail}`,
          fields: [key],
        }
      }
    }
  }
  return OK
}

function checkFieldType(
  value: unknown,
  schema: PayloadFieldSchema,
): string | null {
  if (!schema.type) return null
  switch (schema.type) {
    case "string":
      if (typeof value !== "string") return `expected string, got ${typeOf(value)}`
      return null
    case "number":
      if (typeof value !== "number" || Number.isNaN(value)) {
        return `expected number, got ${typeOf(value)}`
      }
      return null
    case "boolean":
      if (typeof value !== "boolean") {
        return `expected boolean, got ${typeOf(value)}`
      }
      return null
    case "object":
      if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value)
      ) {
        return `expected object, got ${typeOf(value)}`
      }
      return null
    case "array":
      if (!Array.isArray(value)) return `expected array, got ${typeOf(value)}`
      return null
    case "null":
      if (value !== null) return `expected null, got ${typeOf(value)}`
      return null
    default:
      return null
  }
}

function checkEnum(
  value: unknown,
  schema: PayloadFieldSchema,
): string | null {
  if (!schema.enum || schema.enum.length === 0) return null
  // Strict equality scan — schema.enum holds primitives.
  for (const allowed of schema.enum) {
    if (allowed === value) return null
  }
  return `value not in enum (${schema.enum
    .map((v) => JSON.stringify(v))
    .join(", ")})`
}

function typeOf(value: unknown): string {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  return typeof value
}

// ── State-machine helpers (mirror DB triggers) ──────────────────

/**
 * Returns true iff `next` is a legal transition from `current` for an
 * EventStream. Mirror of event_streams_lifecycle_fn in the migration.
 * Caller uses this for fast-fail in API routes before hitting the DB.
 */
export function canTransitionStreamStatus(
  current: StreamStatus,
  next: StreamStatus,
): boolean {
  if (current === next) return true // no-op write
  return STREAM_STATUS_TRANSITIONS[current].includes(next)
}

export function canTransitionSubscriptionStatus(
  current: SubscriptionStatus,
  next: SubscriptionStatus,
): boolean {
  if (current === next) return true
  return SUBSCRIPTION_STATUS_TRANSITIONS[current].includes(next)
}

export function canTransitionDeadLetterTriage(
  current: DeadLetterTriageStatus,
  next: DeadLetterTriageStatus,
): boolean {
  if (current === next) return true
  return DEAD_LETTER_TRIAGE_TRANSITIONS[current].includes(next)
}
