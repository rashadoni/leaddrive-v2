/**
 * P8 No-Code Form Builder — pure submission validator.
 *
 * Given a (pre-validated) FormDefinition.fields and a raw submission
 * payload, returns either:
 *   { ok: true, normalizedData }  — sanitized + ready to persist
 *   { ok: false, errors }         — per-field error list for the
 *                                   renderer to surface inline
 *
 * Pure: no Prisma, no fetch, no Date.now(). The caller decides
 * whether a fresh submission proceeds to persist + downstream effects
 * (Lead creation, notification email, etc.).
 *
 * Error-collection contract: the validator returns all per-field
 * errors that don't depend on type-coercion succeeding. Text/textarea
 * accumulate minLength + maxLength + pattern; number accumulates
 * min + max; select/radio/checkbox/email/phone/url short-circuit on
 * the first failure because subsequent checks would be meaningless
 * once the value's basic shape is wrong. Renderers can rely on at
 * most one error per field per type for "format-gated" fields and on
 * up-to-N errors for "constraint-gated" fields.
 */

import type {
  FieldError,
  FormFieldSchema,
  NormalizedFieldValue,
  ValidationResult,
} from "./types"

// Basic email format — matches the HTML5 spec `<input type=email>`
// pattern (intentionally permissive). Catches typos like "no at
// sign" or "no dot" without rejecting unusual-but-valid addresses.
// Specifically: requires `local@domain.tld` shape, rejects bare
// domains and accepts `a@b.c`. Do NOT "tighten" this without
// reviewing the HTML5 form spec — strictness regresses real users.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Phone — allows + prefix and 7-20 digits + spaces/dashes/parens. Not
// validating country code; assume the renderer enforces region rules.
const PHONE_RE = /^\+?[\d\s\-().]{7,20}$/

// ISO date — yyyy-mm-dd (HTML5 date input default). Time portion
// accepted but stripped to date-only at normalize.
const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:T.*)?$/

export function validateSubmission(
  fields: FormFieldSchema[],
  rawSubmission: unknown,
): ValidationResult {
  if (!rawSubmission || typeof rawSubmission !== "object" || Array.isArray(rawSubmission)) {
    return {
      ok: false,
      errors: [{ key: "_root", code: "shape", message: "submission must be an object" }],
    }
  }
  const submission = rawSubmission as Record<string, unknown>
  const errors: FieldError[] = []
  const normalized: Record<string, NormalizedFieldValue> = {}

  for (const field of fields) {
    const raw = submission[field.key]
    const fieldErrors = validateField(field, raw, normalized)
    errors.push(...fieldErrors)
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, normalizedData: normalized }
}

function validateField(
  field: FormFieldSchema,
  raw: unknown,
  acc: Record<string, NormalizedFieldValue>,
): FieldError[] {
  const errors: FieldError[] = []
  const required = field.required === true

  // Missing-value handling.
  const isMissing = raw === undefined || raw === null || raw === "" ||
    (Array.isArray(raw) && raw.length === 0)
  if (isMissing) {
    if (required) {
      errors.push({ key: field.key, code: "required", message: `${field.label} is required` })
    }
    return errors
  }

  switch (field.type) {
    case "checkbox": {
      // Accepts: ["a", "b"], "a,b", or a single string
      let values: string[]
      if (Array.isArray(raw)) {
        if (!raw.every((v) => typeof v === "string")) {
          return [{ key: field.key, code: "type", message: `${field.label} must be an array of strings` }]
        }
        values = raw as string[]
      } else if (typeof raw === "string") {
        values = raw.split(",").map((s) => s.trim()).filter(Boolean)
      } else {
        return [{ key: field.key, code: "type", message: `${field.label} has an invalid value` }]
      }
      const allowed = new Set((field.options || []).map((o) => o.value))
      const bad = values.filter((v) => !allowed.has(v))
      if (bad.length > 0) {
        return [{ key: field.key, code: "option", message: `${field.label} contains invalid choices: ${bad.join(", ")}` }]
      }
      acc[field.key] = values
      return errors
    }

    case "select":
    case "radio": {
      if (typeof raw !== "string") {
        return [{ key: field.key, code: "type", message: `${field.label} must be a string` }]
      }
      const allowed = new Set((field.options || []).map((o) => o.value))
      if (!allowed.has(raw)) {
        return [{ key: field.key, code: "option", message: `${field.label} is not a valid choice` }]
      }
      acc[field.key] = raw
      return errors
    }

    case "number": {
      const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN
      if (!Number.isFinite(n)) {
        return [{ key: field.key, code: "type", message: `${field.label} must be a number` }]
      }
      if (field.validation?.min !== undefined && n < field.validation.min) {
        errors.push({ key: field.key, code: "min", message: `${field.label} must be >= ${field.validation.min}` })
      }
      if (field.validation?.max !== undefined && n > field.validation.max) {
        errors.push({ key: field.key, code: "max", message: `${field.label} must be <= ${field.validation.max}` })
      }
      // Preserve numeric type so slice-2 Lead-creation / F4 Report
      // Builder can aggregate without re-parsing.
      acc[field.key] = n
      return errors
    }

    case "date": {
      if (typeof raw !== "string" || !DATE_RE.test(raw)) {
        return [{ key: field.key, code: "format", message: `${field.label} must be yyyy-mm-dd` }]
      }
      const dateOnly = raw.slice(0, 10) // strip any time portion
      acc[field.key] = dateOnly
      return errors
    }

    case "email": {
      if (typeof raw !== "string" || !EMAIL_RE.test(raw)) {
        return [{ key: field.key, code: "format", message: `${field.label} must be a valid email` }]
      }
      acc[field.key] = raw.trim().toLowerCase()
      return errors
    }

    case "phone": {
      if (typeof raw !== "string" || !PHONE_RE.test(raw)) {
        return [{ key: field.key, code: "format", message: `${field.label} must be a valid phone number` }]
      }
      acc[field.key] = raw.trim()
      return errors
    }

    case "url": {
      if (typeof raw !== "string") {
        return [{ key: field.key, code: "type", message: `${field.label} must be a string` }]
      }
      try {
        new URL(raw)
      } catch {
        return [{ key: field.key, code: "format", message: `${field.label} must be a valid URL` }]
      }
      acc[field.key] = raw.trim()
      return errors
    }

    case "text":
    case "textarea":
    case "hidden": {
      if (typeof raw !== "string") {
        return [{ key: field.key, code: "type", message: `${field.label} must be a string` }]
      }
      const v = field.type === "hidden" ? raw : raw.trim()
      if (field.validation?.minLength !== undefined && v.length < field.validation.minLength) {
        errors.push({ key: field.key, code: "minLength", message: `${field.label} must be at least ${field.validation.minLength} characters` })
      }
      if (field.validation?.maxLength !== undefined && v.length > field.validation.maxLength) {
        errors.push({ key: field.key, code: "maxLength", message: `${field.label} cannot exceed ${field.validation.maxLength} characters` })
      }
      if (field.validation?.pattern !== undefined) {
        let pattern: RegExp | null = null
        try {
          pattern = new RegExp(field.validation.pattern)
        } catch {
          /* swallowed — definition validator should have caught this */
        }
        if (pattern && !pattern.test(v)) {
          errors.push({ key: field.key, code: "pattern", message: `${field.label} format is invalid` })
        }
      }
      acc[field.key] = v
      return errors
    }

    default: {
      // Defence-in-depth: validateFormDefinition gates `type` against
      // FORM_FIELD_TYPES, but a hand-edited DB row or a future enum
      // expansion that misses this switch shouldn't crash the route.
      return [{ key: field.key, code: "type", message: `${field.label} has an unrecognized field type` }]
    }
  }
}
