/**
 * P8 No-Code Form Builder — shared field type taxonomy + schemas.
 *
 * Mirrors the in-schema doc on `FormDefinition.fields`. Slice-2 route
 * payloads validate against `validateFormDefinition` (in
 * `./validate-definition.ts`) which uses these types as the source
 * of truth.
 */

/** Lifecycle status — mirrors the DB CHECK in
 *  `prisma/migrations/20260529180000_add_p8_form_definitions/migration.sql`. */
export const FORM_STATUSES = ["draft", "published", "archived"] as const
export type FormStatus = (typeof FORM_STATUSES)[number]

/** Field renderer types. New types: add here AND in renderer.
 *  - text:     single-line text
 *  - email:    text with email validation
 *  - phone:    text with phone validation (basic E.164-ish)
 *  - url:      text with URL validation
 *  - textarea: multi-line text
 *  - number:   numeric
 *  - select:   dropdown, options[].value submitted
 *  - radio:    single-choice
 *  - checkbox: multi-choice; submitted as comma-joined or array
 *  - date:     ISO date string
 *  - hidden:   not rendered, populated from URL query (e.g. utm_source)
 */
export const FORM_FIELD_TYPES = [
  "text",
  "email",
  "phone",
  "url",
  "textarea",
  "number",
  "select",
  "radio",
  "checkbox",
  "date",
  "hidden",
] as const
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number]

export interface FormFieldOption {
  label: string
  value: string
}

export interface FormFieldValidation {
  minLength?: number
  maxLength?: number
  pattern?: string // regex source — compiled at validation time
  min?: number // for type=number / type=date (ISO)
  max?: number
}

export interface FormFieldSchema {
  key: string
  type: FormFieldType
  label: string
  required?: boolean
  placeholder?: string
  helpText?: string
  /** Applied client-side by the slice-2 renderer at mount; the
   *  submission validator only sees the user-edited value (or empty
   *  string if the user cleared a defaulted field). */
  defaultValue?: string
  options?: FormFieldOption[] // required for select / radio / checkbox
  validation?: FormFieldValidation
}

/** Per-field validation-error shape. Slice-2 renderer surfaces these
 *  next to the offending input.
 *
 *  NOTE on `details` envelope shape divergence between routes:
 *    - PUT  /api/v1/forms/[id]               → `details: string[]`
 *      (output of `validateFormDefinition` — definition-level errors,
 *       not field-bound. Each entry is `field[N].thing must be ...`.)
 *    - POST /api/v1/public/forms/[slug]/submit → `details: FieldError[]`
 *      (output of `validateSubmission` — keyed by `field.key` for the
 *       renderer to attach error text to the right input.)
 *
 *  Clients hitting one route should NOT reuse the type from the
 *  other. The editor page only consumes the PUT shape; the public
 *  widget only consumes the submit shape. Slice-4 may unify if we
 *  want a single error rendering pipeline. */
export interface FieldError {
  key: string
  code: string // e.g. "required" | "maxLength" | "format"
  message: string
}

/** Per-field-value type after normalization. `number` fields preserve
 *  numeric type so slice-2 Lead-creation + F4 Report Builder can
 *  aggregate over them. JSONB persistence preserves this distinction. */
export type NormalizedFieldValue = string | string[] | number

/** Top-level submission-validation result. */
export type ValidationResult =
  | { ok: true; normalizedData: Record<string, NormalizedFieldValue> }
  | { ok: false; errors: FieldError[] }

/** Sanity cap on FormDefinition.fields length. Exported so slice-2
 *  builder UI can render a "X / MAX_FIELDS" capacity indicator. */
export const MAX_FIELDS = 200
