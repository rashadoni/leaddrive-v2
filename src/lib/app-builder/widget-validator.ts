/**
 * Widget config validator — N2 Phase 6 Block D slice 1.
 *
 * Per-type shape + bounds checks on the JSONB `config` blob attached
 * to a LightningPageWidget row. Caller invokes before INSERT/UPDATE
 * so we don't persist malformed configs that would crash the slice-2
 * render layer.
 *
 * Defense-in-depth:
 *   • Object.prototype.hasOwnProperty.call on all field reads —
 *     prototype-chain injection covered.
 *   • Numeric bounds (limit, heightPx) clamp anti-DoS for slice-2
 *     render layer.
 *   • String length bounds (html body, fields[] entries) anti-DoS.
 *   • URL allowlist for embed_external is slice-2 (admin tenant
 *     config); slice-1 only checks shape + `https://` prefix as a
 *     baseline.
 *
 * Pure synchronous. Returns discriminated union.
 */
import {
  WIDGET_TYPES,
  type ValidateWidgetInput,
  type ValidateWidgetResult,
  type WidgetType,
} from "./types"

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function has(o: Record<string, unknown>, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k)
}

function isPositiveInt(v: unknown, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0 && v <= max
}

const MAX_FIELDS_PER_WIDGET = 32
const MAX_FIELD_NAME_CHARS = 64
const MAX_LIMIT = 200
const MAX_LABEL_CHARS = 200
const MAX_HTML_CHARS = 100_000
const MAX_EMBED_HEIGHT_PX = 4000
const MAX_GROUP_LABEL_CHARS = 100
const MAX_CHART_TITLE_CHARS = 200
const MAX_ACTIONS_PER_WIDGET = 16
const MAX_ACTIVITY_KINDS = 8

const ALLOWED_CHART_TYPES = new Set(["bar", "line", "pie", "donut"])
const ALLOWED_ACTIVITY_KINDS = new Set(["calls", "emails", "tasks", "notes"])

function validateRecordDetails(
  raw: Record<string, unknown>,
  errors: string[]
): boolean {
  if (!has(raw, "fields") || !Array.isArray(raw.fields)) {
    errors.push("record_details: fields must be an array")
    return false
  }
  if (raw.fields.length === 0) {
    errors.push("record_details: fields must be non-empty")
    return false
  }
  if (raw.fields.length > MAX_FIELDS_PER_WIDGET) {
    errors.push(`record_details: fields length ${raw.fields.length} exceeds ${MAX_FIELDS_PER_WIDGET}`)
    return false
  }
  for (let i = 0; i < raw.fields.length; i++) {
    const f = raw.fields[i]
    if (typeof f !== "string" || f.length === 0 || f.length > MAX_FIELD_NAME_CHARS) {
      errors.push(`record_details: fields[${i}] must be a non-empty string ≤ ${MAX_FIELD_NAME_CHARS} chars`)
      return false
    }
  }
  if (has(raw, "groupLabel")) {
    if (typeof raw.groupLabel !== "string" || raw.groupLabel.length > MAX_GROUP_LABEL_CHARS) {
      errors.push(`record_details: groupLabel must be a string ≤ ${MAX_GROUP_LABEL_CHARS} chars`)
      return false
    }
  }
  return true
}

function validateRelatedList(
  raw: Record<string, unknown>,
  errors: string[]
): boolean {
  if (!has(raw, "relatedModel") || typeof raw.relatedModel !== "string" || raw.relatedModel.length === 0) {
    errors.push("related_list: relatedModel must be a non-empty string")
    return false
  }
  if (raw.relatedModel.length > MAX_FIELD_NAME_CHARS) {
    errors.push(`related_list: relatedModel length exceeds ${MAX_FIELD_NAME_CHARS}`)
    return false
  }
  if (!has(raw, "limit") || !isPositiveInt(raw.limit, MAX_LIMIT)) {
    errors.push(`related_list: limit must be a positive integer ≤ ${MAX_LIMIT}`)
    return false
  }
  if (!has(raw, "columns") || !Array.isArray(raw.columns)) {
    errors.push("related_list: columns must be an array")
    return false
  }
  if (raw.columns.length === 0 || raw.columns.length > MAX_FIELDS_PER_WIDGET) {
    errors.push(`related_list: columns must be 1..${MAX_FIELDS_PER_WIDGET}`)
    return false
  }
  for (let i = 0; i < raw.columns.length; i++) {
    const c = raw.columns[i]
    if (typeof c !== "string" || c.length === 0 || c.length > MAX_FIELD_NAME_CHARS) {
      errors.push(`related_list: columns[${i}] must be a non-empty string ≤ ${MAX_FIELD_NAME_CHARS} chars`)
      return false
    }
  }
  return true
}

function validateChart(raw: Record<string, unknown>, errors: string[]): boolean {
  if (!has(raw, "chartType") || typeof raw.chartType !== "string") {
    errors.push("chart: chartType must be a string")
    return false
  }
  if (!ALLOWED_CHART_TYPES.has(raw.chartType)) {
    errors.push(`chart: chartType must be one of ${Array.from(ALLOWED_CHART_TYPES).join(", ")}`)
    return false
  }
  if (!has(raw, "dataSource") || typeof raw.dataSource !== "string" || raw.dataSource.length === 0) {
    errors.push("chart: dataSource must be a non-empty string")
    return false
  }
  if (raw.dataSource.length > MAX_FIELD_NAME_CHARS) {
    errors.push(`chart: dataSource length exceeds ${MAX_FIELD_NAME_CHARS}`)
    return false
  }
  if (has(raw, "title")) {
    if (typeof raw.title !== "string" || raw.title.length > MAX_CHART_TITLE_CHARS) {
      errors.push(`chart: title must be a string ≤ ${MAX_CHART_TITLE_CHARS} chars`)
      return false
    }
  }
  return true
}

function validateQuickActions(
  raw: Record<string, unknown>,
  errors: string[]
): boolean {
  if (!has(raw, "actions") || !Array.isArray(raw.actions)) {
    errors.push("quick_actions: actions must be an array")
    return false
  }
  if (raw.actions.length === 0 || raw.actions.length > MAX_ACTIONS_PER_WIDGET) {
    errors.push(`quick_actions: actions length must be 1..${MAX_ACTIONS_PER_WIDGET}`)
    return false
  }
  for (let i = 0; i < raw.actions.length; i++) {
    const a = raw.actions[i]
    if (typeof a !== "string" || a.length === 0 || a.length > MAX_LABEL_CHARS) {
      errors.push(`quick_actions: actions[${i}] must be a non-empty string`)
      return false
    }
  }
  return true
}

function validateActivityTimeline(
  raw: Record<string, unknown>,
  errors: string[]
): boolean {
  if (!has(raw, "include") || !Array.isArray(raw.include)) {
    errors.push("activity_timeline: include must be an array")
    return false
  }
  if (raw.include.length === 0 || raw.include.length > MAX_ACTIVITY_KINDS) {
    errors.push(`activity_timeline: include length must be 1..${MAX_ACTIVITY_KINDS}`)
    return false
  }
  for (let i = 0; i < raw.include.length; i++) {
    const k = raw.include[i]
    if (typeof k !== "string" || !ALLOWED_ACTIVITY_KINDS.has(k)) {
      errors.push(
        `activity_timeline: include[${i}] "${String(k)}" not in allowed kinds (${Array.from(ALLOWED_ACTIVITY_KINDS).join(", ")})`
      )
      return false
    }
  }
  if (!has(raw, "limit") || !isPositiveInt(raw.limit, MAX_LIMIT)) {
    errors.push(`activity_timeline: limit must be a positive integer ≤ ${MAX_LIMIT}`)
    return false
  }
  return true
}

function validateHtml(raw: Record<string, unknown>, errors: string[]): boolean {
  if (!has(raw, "html") || typeof raw.html !== "string") {
    errors.push("html: html must be a string")
    return false
  }
  if (raw.html.length > MAX_HTML_CHARS) {
    errors.push(`html: html body length ${raw.html.length} exceeds ${MAX_HTML_CHARS}`)
    return false
  }
  // ⚠ XSS WARNING ⚠
  // This validator does NOT sanitise the HTML body. Persisting an
  // unsanitised string is intentional (we want admins to author
  // controlled markup), but the slice-2 render layer MUST run
  // DOMPurify (or equivalent) BEFORE injecting into the DOM. The
  // JSONB blob is attacker-influenceable via any code path that
  // doesn't run this validator first, so the render layer treats
  // it as untrusted regardless. Architect-pass-1 close-out: this
  // reminder lives at the validation site so the next dev wiring
  // slice-2 sees it before they trust the column.
  return true
}

function validateEmbedExternal(
  raw: Record<string, unknown>,
  errors: string[]
): boolean {
  if (!has(raw, "url") || typeof raw.url !== "string" || raw.url.length === 0) {
    errors.push("embed_external: url must be a non-empty string")
    return false
  }
  if (!/^https:\/\//.test(raw.url)) {
    errors.push("embed_external: url must start with https://")
    return false
  }
  if (raw.url.length > 2048) {
    errors.push("embed_external: url length exceeds 2048")
    return false
  }
  if (!has(raw, "heightPx") || !isPositiveInt(raw.heightPx, MAX_EMBED_HEIGHT_PX)) {
    errors.push(`embed_external: heightPx must be a positive integer ≤ ${MAX_EMBED_HEIGHT_PX}`)
    return false
  }
  if (!has(raw, "allowCookies") || typeof raw.allowCookies !== "boolean") {
    errors.push("embed_external: allowCookies must be a boolean")
    return false
  }
  return true
}

export function validateWidgetConfig(
  input: ValidateWidgetInput
): ValidateWidgetResult {
  const errors: string[] = []

  if (!(WIDGET_TYPES as readonly string[]).includes(input.widgetType as WidgetType)) {
    errors.push(`unknown widgetType "${String(input.widgetType)}"`)
    return { ok: false, errors }
  }
  if (!isPlainObject(input.config)) {
    errors.push("config must be a plain object")
    return { ok: false, errors }
  }

  let ok = false
  switch (input.widgetType) {
    case "record_details":
      ok = validateRecordDetails(input.config, errors)
      break
    case "related_list":
      ok = validateRelatedList(input.config, errors)
      break
    case "chart":
      ok = validateChart(input.config, errors)
      break
    case "quick_actions":
      ok = validateQuickActions(input.config, errors)
      break
    case "activity_timeline":
      ok = validateActivityTimeline(input.config, errors)
      break
    case "html":
      ok = validateHtml(input.config, errors)
      break
    case "embed_external":
      ok = validateEmbedExternal(input.config, errors)
      break
  }
  if (!ok) return { ok: false, errors }
  return { ok: true, widgetType: input.widgetType, config: input.config }
}
