/**
 * P8 No-Code Form Builder — pure FormDefinition.fields validator.
 *
 * Used by:
 *   - slice-2 POST/PUT routes to reject malformed JSON early
 *   - slice-2 publish flow to ensure a draft is valid before going
 *     live (prevents publishing a form that would 500 on every
 *     submission)
 *
 * Pure: no Prisma, no Date.now(), no fetch.
 */

import { FORM_FIELD_TYPES, MAX_FIELDS, type FormFieldSchema, type FormFieldType } from "./types"

const KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/

export interface DefinitionValidationResult {
  ok: boolean
  errors: string[]
  /** Sanitized fields with `options: []` defaulted where applicable. */
  cleanFields?: FormFieldSchema[]
}

export function validateFormDefinition(rawFields: unknown): DefinitionValidationResult {
  const errors: string[] = []
  if (!Array.isArray(rawFields)) {
    return { ok: false, errors: ["fields must be a non-empty JSON array"] }
  }
  if (rawFields.length === 0) {
    return { ok: false, errors: ["fields must contain at least one field"] }
  }
  if (rawFields.length > MAX_FIELDS) {
    // Sanity cap — UI builder limit, prevents pathological forms.
    return { ok: false, errors: [`fields cannot exceed ${MAX_FIELDS} entries`] }
  }

  const cleanFields: FormFieldSchema[] = []
  const seenKeys = new Set<string>()

  for (let i = 0; i < rawFields.length; i++) {
    const raw = rawFields[i]
    const prefix = `field[${i}]`

    if (!raw || typeof raw !== "object") {
      errors.push(`${prefix} must be an object`)
      continue
    }
    const r = raw as Record<string, unknown>

    // key
    if (typeof r.key !== "string" || !KEY_PATTERN.test(r.key)) {
      errors.push(`${prefix}.key must be 1-64 chars, [a-zA-Z][a-zA-Z0-9_-]*`)
      continue
    }
    if (seenKeys.has(r.key)) {
      errors.push(`${prefix}.key "${r.key}" is duplicated`)
      continue
    }
    seenKeys.add(r.key)

    // type
    if (typeof r.type !== "string" || !FORM_FIELD_TYPES.includes(r.type as FormFieldType)) {
      errors.push(`${prefix}.type must be one of: ${FORM_FIELD_TYPES.join(", ")}`)
      continue
    }
    const type = r.type as FormFieldType

    // label
    if (typeof r.label !== "string" || r.label.trim() === "") {
      errors.push(`${prefix}.label is required (non-empty string)`)
      continue
    }
    if (r.label.length > 255) {
      errors.push(`${prefix}.label exceeds max length of 255 characters`)
      continue
    }

    // options — required for select/radio/checkbox
    let options: FormFieldSchema["options"]
    if (type === "select" || type === "radio" || type === "checkbox") {
      if (!Array.isArray(r.options) || r.options.length === 0) {
        errors.push(`${prefix}.options must be a non-empty array for type=${type}`)
        continue
      }
      const cleanOpts: FormFieldSchema["options"] = []
      let optError = false
      for (let j = 0; j < r.options.length; j++) {
        const opt = r.options[j] as Record<string, unknown> | null
        if (!opt || typeof opt.label !== "string" || typeof opt.value !== "string") {
          errors.push(`${prefix}.options[${j}] must be { label: string, value: string }`)
          optError = true
          break
        }
        cleanOpts.push({ label: opt.label, value: opt.value })
      }
      if (optError) continue
      options = cleanOpts
    } else if (r.options !== undefined && r.options !== null) {
      // Reject options on field types that don't use them — silent
      // ignore would let the UI builder leak stale state into prod.
      errors.push(`${prefix}.options is not supported for type=${type}`)
      continue
    }

    // validation — optional object
    let validation: FormFieldSchema["validation"]
    if (r.validation !== undefined && r.validation !== null) {
      if (typeof r.validation !== "object") {
        errors.push(`${prefix}.validation must be an object`)
        continue
      }
      const v = r.validation as Record<string, unknown>
      const out: NonNullable<FormFieldSchema["validation"]> = {}
      if (v.minLength !== undefined) {
        if (typeof v.minLength !== "number" || v.minLength < 0) {
          errors.push(`${prefix}.validation.minLength must be a non-negative number`)
          continue
        }
        out.minLength = v.minLength
      }
      if (v.maxLength !== undefined) {
        if (typeof v.maxLength !== "number" || v.maxLength < 1) {
          errors.push(`${prefix}.validation.maxLength must be a positive number`)
          continue
        }
        out.maxLength = v.maxLength
      }
      if (out.minLength !== undefined && out.maxLength !== undefined && out.minLength > out.maxLength) {
        errors.push(`${prefix}.validation.minLength cannot exceed maxLength`)
        continue
      }
      if (v.pattern !== undefined) {
        if (typeof v.pattern !== "string") {
          errors.push(`${prefix}.validation.pattern must be a regex source string`)
          continue
        }
        try {
          new RegExp(v.pattern)
        } catch {
          errors.push(`${prefix}.validation.pattern is not a valid regex`)
          continue
        }
        out.pattern = v.pattern
      }
      if (v.min !== undefined) {
        if (typeof v.min !== "number") {
          errors.push(`${prefix}.validation.min must be a number`)
          continue
        }
        out.min = v.min
      }
      if (v.max !== undefined) {
        if (typeof v.max !== "number") {
          errors.push(`${prefix}.validation.max must be a number`)
          continue
        }
        out.max = v.max
      }
      validation = Object.keys(out).length > 0 ? out : undefined
    }

    cleanFields.push({
      key: r.key,
      type,
      label: r.label,
      required: r.required === true ? true : undefined,
      placeholder: typeof r.placeholder === "string" ? r.placeholder : undefined,
      helpText: typeof r.helpText === "string" ? r.helpText : undefined,
      defaultValue: typeof r.defaultValue === "string" ? r.defaultValue : undefined,
      options,
      validation,
    })
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }
  return { ok: true, errors: [], cleanFields }
}
