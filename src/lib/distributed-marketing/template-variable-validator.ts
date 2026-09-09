/**
 * C7 template-variable-validator — slice-1 pure helper.
 *
 * Validates that:
 *   1. Every {{placeholder}} in subject + body is declared in EITHER
 *      lockedVariables OR unlockedVariables — never both, never neither.
 *   2. No unlockedVariable slot name collides with a lockedVariables key
 *      (corporate copy cannot be overridden by reps).
 *   3. Slot shapes are well-formed (name + label + type).
 *   4. Personalization fills (rep-side) only target unlocked slot names
 *      and don't try to override locked keys.
 *
 * Pure function: no DB.
 */

import {
  TEMPLATE_STATUSES,
  TEMPLATE_STATUS_TRANSITIONS,
  PERSONALIZATION_STATUSES,
  PERSONALIZATION_STATUS_TRANSITIONS,
  TEMPLATE_CHANNELS,
  CHANNELS_REQUIRING_SUBJECT,
  RESERVED_PLACEHOLDER_PREFIXES,
  VARIABLE_SLOT_TYPES,
  type PersonalizationStatus,
  type TemplateChannel,
  type TemplateStatus,
  type VariableSlot,
  type VariableSlotType,
} from "./types"

const PLACEHOLDER_REGEX = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g

export interface ValidationOk {
  ok: true
}

export interface ValidationError {
  ok: false
  code:
    | "placeholder_undeclared"
    | "variable_in_both_buckets"
    | "slot_shape_invalid"
    | "slot_type_unknown"
    | "duplicate_slot_name"
    | "channel_subject_mismatch"
    | "personalization_key_locked"
    | "personalization_unknown_key"
    | "personalization_required_missing"
    | "personalization_value_type_mismatch"
  message: string
  /** Field paths or variable names that failed. */
  fields?: string[]
}

export type ValidationResult = ValidationOk | ValidationError

const OK: ValidationOk = { ok: true }

// ── Template-side validation ────────────────────────────────────

export interface TemplateValidationInput {
  channel: TemplateChannel
  subjectTemplate?: string | null
  bodyTemplate: string
  lockedVariables: Record<string, unknown>
  unlockedVariables: VariableSlot[]
}

/**
 * Validate a template's variable declarations against its body/subject.
 */
export function validateTemplate(
  input: TemplateValidationInput,
): ValidationResult {
  // 1. Channel-subject coherence.
  const subjectRequired = CHANNELS_REQUIRING_SUBJECT.includes(input.channel)
  if (subjectRequired && (input.subjectTemplate ?? "").trim() === "") {
    return {
      ok: false,
      code: "channel_subject_mismatch",
      message: `channel ${input.channel} requires a non-empty subjectTemplate`,
    }
  }
  if (
    !subjectRequired &&
    input.subjectTemplate !== null &&
    input.subjectTemplate !== undefined &&
    input.subjectTemplate !== ""
  ) {
    return {
      ok: false,
      code: "channel_subject_mismatch",
      message: `channel ${input.channel} must have null subjectTemplate (body-only channel)`,
    }
  }

  // 2. Slot shape validity + dedup + type.
  // Architect pass-1 fix: slice-2 may hand raw JSONB from DB (typed
  // `Json`) which could be non-array (`{}`, null, or arbitrary object
  // if stored bypassing validator). Guard against TypeError before
  // the helpful slot_shape_invalid error path.
  if (!Array.isArray(input.unlockedVariables)) {
    return {
      ok: false,
      code: "slot_shape_invalid",
      message: "unlockedVariables must be an array",
      fields: ["unlockedVariables"],
    }
  }
  const slotNames = new Set<string>()
  for (let i = 0; i < input.unlockedVariables.length; i++) {
    const slot = input.unlockedVariables[i]
    if (!isValidSlotShape(slot)) {
      return {
        ok: false,
        code: "slot_shape_invalid",
        message: `unlockedVariables[${i}] must have name, label, type`,
        fields: [`unlockedVariables[${i}]`],
      }
    }
    if (!VARIABLE_SLOT_TYPES.includes(slot.type)) {
      return {
        ok: false,
        code: "slot_type_unknown",
        message: `unlockedVariables[${i}].type "${slot.type}" not in [${VARIABLE_SLOT_TYPES.join(",")}]`,
        fields: [`unlockedVariables[${i}].type`],
      }
    }
    if (slotNames.has(slot.name)) {
      return {
        ok: false,
        code: "duplicate_slot_name",
        message: `unlockedVariables: duplicate slot name "${slot.name}"`,
        fields: [`unlockedVariables[${i}].name`],
      }
    }
    slotNames.add(slot.name)
  }

  // 3. No overlap between locked + unlocked.
  const lockedKeys = new Set(Object.keys(input.lockedVariables))
  const overlap: string[] = []
  for (const slot of input.unlockedVariables) {
    if (lockedKeys.has(slot.name)) overlap.push(slot.name)
  }
  if (overlap.length > 0) {
    return {
      ok: false,
      code: "variable_in_both_buckets",
      message: `variables in BOTH locked and unlocked: ${overlap.join(", ")}`,
      fields: overlap,
    }
  }

  // 4. Every placeholder in body/subject declared in one bucket.
  const placeholders = collectPlaceholders(input.bodyTemplate)
  if (input.subjectTemplate) {
    for (const p of collectPlaceholders(input.subjectTemplate)) {
      placeholders.add(p)
    }
  }
  const undeclared: string[] = []
  for (const p of placeholders) {
    if (lockedKeys.has(p) || slotNames.has(p)) continue
    // Reserved-prefix placeholders (contact_*, today_*, sender_*) are
    // filled at send time from per-send context; no declaration needed.
    if (hasReservedPrefix(p)) continue
    undeclared.push(p)
  }
  if (undeclared.length > 0) {
    return {
      ok: false,
      code: "placeholder_undeclared",
      message: `placeholders not declared: ${undeclared.join(", ")}`,
      fields: undeclared,
    }
  }

  return OK
}

function hasReservedPrefix(placeholder: string): boolean {
  for (const prefix of RESERVED_PLACEHOLDER_PREFIXES) {
    if (placeholder.startsWith(prefix)) return true
  }
  return false
}

// ── Personalization-side validation ─────────────────────────────

export interface PersonalizationValidationInput {
  template: {
    lockedVariables: Record<string, unknown>
    unlockedVariables: VariableSlot[]
  }
  variableValues: Record<string, unknown>
  /** If true, all required slots must have a value (active status). */
  requireAllRequired: boolean
}

/**
 * Validate a rep's personalization fill.
 *
 * Returns first failure or OK. Caller (slice-2 admin UI / API) hands
 * this output to the user; can run with requireAllRequired=false during
 * draft saves and =true on transition-to-active.
 */
export function validatePersonalization(
  input: PersonalizationValidationInput,
): ValidationResult {
  const lockedKeys = new Set(Object.keys(input.template.lockedVariables))
  const slotByName = new Map<string, VariableSlot>()
  for (const slot of input.template.unlockedVariables) {
    slotByName.set(slot.name, slot)
  }

  // 1. No key targets a locked variable.
  for (const key of Object.keys(input.variableValues)) {
    if (lockedKeys.has(key)) {
      return {
        ok: false,
        code: "personalization_key_locked",
        message: `cannot override locked variable "${key}"`,
        fields: [key],
      }
    }
    if (!slotByName.has(key)) {
      return {
        ok: false,
        code: "personalization_unknown_key",
        message: `key "${key}" is not a declared unlocked slot`,
        fields: [key],
      }
    }
  }

  // 2. Type-tag check per slot.
  for (const [key, value] of Object.entries(input.variableValues)) {
    const slot = slotByName.get(key)!
    const typeFail = checkValueType(value, slot.type)
    if (typeFail !== null) {
      return {
        ok: false,
        code: "personalization_value_type_mismatch",
        message: `value for "${key}" (type ${slot.type}): ${typeFail}`,
        fields: [key],
      }
    }
  }

  // 3. Required-slot completeness check (only when activating).
  if (input.requireAllRequired) {
    const missing: string[] = []
    for (const slot of input.template.unlockedVariables) {
      if (slot.required && !(slot.name in input.variableValues)) {
        // A slot with a defaultValue is considered "filled" implicitly.
        if (slot.defaultValue === undefined) missing.push(slot.name)
      }
    }
    if (missing.length > 0) {
      return {
        ok: false,
        code: "personalization_required_missing",
        message: `required slots not filled: ${missing.join(", ")}`,
        fields: missing,
      }
    }
  }

  return OK
}

// ── Internals ───────────────────────────────────────────────────

function collectPlaceholders(template: string): Set<string> {
  const found = new Set<string>()
  let match: RegExpExecArray | null
  PLACEHOLDER_REGEX.lastIndex = 0
  while ((match = PLACEHOLDER_REGEX.exec(template)) !== null) {
    found.add(match[1])
  }
  return found
}

function isValidSlotShape(slot: unknown): slot is VariableSlot {
  if (!slot || typeof slot !== "object" || Array.isArray(slot)) return false
  const s = slot as Partial<VariableSlot>
  if (typeof s.name !== "string" || s.name.trim() === "") return false
  if (typeof s.label !== "string" || s.label.trim() === "") return false
  if (typeof s.type !== "string") return false
  return true
}

function checkValueType(
  value: unknown,
  type: VariableSlotType,
): string | null {
  switch (type) {
    case "string":
    case "text":
      if (typeof value !== "string") return `expected string, got ${typeOf(value)}`
      return null
    case "url":
      if (typeof value !== "string") return `expected URL string, got ${typeOf(value)}`
      if (!isValidUrl(value)) return `invalid URL: ${value}`
      return null
    case "email":
      if (typeof value !== "string") return `expected email string, got ${typeOf(value)}`
      // Light shape check — slice-2 validator can use a stronger lib.
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `invalid email: ${value}`
      return null
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return `expected finite number, got ${typeOf(value)}`
      }
      return null
    case "boolean":
      if (typeof value !== "boolean") return `expected boolean, got ${typeOf(value)}`
      return null
    default:
      return null
  }
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

function typeOf(value: unknown): string {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  return typeof value
}

// ── State-machine helpers (mirror DB triggers) ──────────────────

export function isTemplateStatus(value: unknown): value is TemplateStatus {
  return (
    typeof value === "string" &&
    TEMPLATE_STATUSES.includes(value as TemplateStatus)
  )
}

export function canTransitionTemplateStatus(
  current: TemplateStatus,
  next: TemplateStatus,
): boolean {
  if (current === next) return true
  return TEMPLATE_STATUS_TRANSITIONS[current].includes(next)
}

export function isPersonalizationStatus(
  value: unknown,
): value is PersonalizationStatus {
  return (
    typeof value === "string" &&
    PERSONALIZATION_STATUSES.includes(value as PersonalizationStatus)
  )
}

export function canTransitionPersonalizationStatus(
  current: PersonalizationStatus,
  next: PersonalizationStatus,
): boolean {
  if (current === next) return true
  return PERSONALIZATION_STATUS_TRANSITIONS[current].includes(next)
}

export function isTemplateChannel(value: unknown): value is TemplateChannel {
  return (
    typeof value === "string" &&
    TEMPLATE_CHANNELS.includes(value as TemplateChannel)
  )
}
