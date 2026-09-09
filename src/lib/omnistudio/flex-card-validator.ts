/**
 * FlexCard config validator — N16 Phase 6 Block D slice 2.
 *
 * Validates the JSONB `config` blob attached to OmniStudioFlexCard.
 * Checks: structural shape, section/field counts within bounds,
 * unique section IDs, conditional `var` references resolve against
 * declared variables, field paths reasonable length.
 *
 * Pure synchronous. Returns discriminated union.
 *
 * Defense-in-depth:
 *   • Object.prototype.hasOwnProperty.call on field reads.
 *   • Forbidden variable names (`__proto__`/`constructor`/`prototype`)
 *     rejected at spec validation step.
 *   • Section/field count bounds anti-DoS for slice-2 renderer.
 */
import {
  DEFAULT_FLEX_CARD_LIMITS,
  FIELD_VALUE_TYPES,
  type FieldValueType,
  type FlexCardConfig,
  type FlexCardLimits,
  type FlexCardSection,
  type ValidateFlexCardInput,
  type ValidateFlexCardResult,
} from "./types"

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function has(o: Record<string, unknown>, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k)
}

const FORBIDDEN_VAR_NAMES = new Set(["__proto__", "constructor", "prototype"])

function isValidIdentifier(s: unknown): s is string {
  return typeof s === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) && s.length <= 64
}

function validateConditional(
  raw: unknown,
  declaredVars: Set<string>,
  declaredVarTypes: Map<string, FieldValueType>,
  path: string,
  errors: string[]
): boolean {
  if (raw === undefined) return true
  if (!isPlainObject(raw)) {
    errors.push(`${path}: conditional must be an object {var, equals}`)
    return false
  }
  const condVar = raw.var
  if (!isValidIdentifier(condVar)) {
    errors.push(`${path}: conditional.var must be an identifier`)
    return false
  }
  if (FORBIDDEN_VAR_NAMES.has(condVar)) {
    errors.push(`${path}: conditional.var "${condVar}" is reserved (JS prototype chain)`)
    return false
  }
  if (!declaredVars.has(condVar)) {
    errors.push(
      `${path}: conditional.var "${condVar}" is not declared in config.variables or any section field`
    )
    return false
  }
  // Reject date-typed conditionals. The renderer compares values via
  // `===` after coercing Date instances to ms via getTime() — but the
  // `equals` literal is `string | number | boolean`. A date-typed
  // conditional would silently always fail equality (number !== string).
  // Architect-pass-1 close-out: reject explicitly at validator level so
  // authors get a loud error instead of a quietly broken section gate.
  const condVarType = declaredVarTypes.get(condVar)
  if (condVarType === "date") {
    errors.push(
      `${path}: conditional.var "${condVar}" is a date-typed field; date-typed conditionals are unsupported in slice 1 (use a derived boolean field via slice-2 formula fields instead)`
    )
    return false
  }
  const eq = raw.equals
  if (
    eq === undefined ||
    (typeof eq !== "string" && typeof eq !== "number" && typeof eq !== "boolean")
  ) {
    errors.push(`${path}: conditional.equals must be string | number | boolean`)
    return false
  }
  return true
}

function validateField(
  raw: unknown,
  declaredVars: Set<string>,
  declaredVarTypes: Map<string, FieldValueType>,
  path: string,
  limits: FlexCardLimits,
  errors: string[]
): boolean {
  if (!isPlainObject(raw)) {
    errors.push(`${path}: field must be an object`)
    return false
  }
  const fieldPath = raw.path
  if (typeof fieldPath !== "string" || fieldPath.length === 0) {
    errors.push(`${path}: field.path must be a non-empty string`)
    return false
  }
  if (fieldPath.length > limits.maxFieldPathChars) {
    errors.push(`${path}: field.path length exceeds ${limits.maxFieldPathChars}`)
    return false
  }
  // Dotted path shape — `name`, `company.name`, `totalSpent`. Disallow
  // double dots or trailing dot.
  if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(fieldPath)) {
    errors.push(`${path}: field.path "${fieldPath}" must be a dotted identifier path`)
    return false
  }
  // Defense-in-depth: reject any segment that matches FORBIDDEN_VAR_NAMES
  // — a hostile config could declare `{ path: "__proto__" }` and later
  // reference it via a conditional. Architect-pass-1 close-out for slice 1.
  for (const segment of fieldPath.split(".")) {
    if (FORBIDDEN_VAR_NAMES.has(segment)) {
      errors.push(
        `${path}: field.path "${fieldPath}" contains forbidden segment "${segment}" (JS prototype chain)`
      )
      return false
    }
  }
  const label = raw.label
  if (typeof label !== "string" || label.length === 0) {
    errors.push(`${path}: field.label must be a non-empty string`)
    return false
  }
  if (label.length > limits.maxLabelChars) {
    errors.push(`${path}: field.label length exceeds ${limits.maxLabelChars}`)
    return false
  }
  const vt = raw.valueType
  if (!(FIELD_VALUE_TYPES as readonly string[]).includes(vt as FieldValueType)) {
    errors.push(`${path}: field.valueType "${String(vt)}" not in allowed types`)
    return false
  }
  if (has(raw, "visibleIf")) {
    if (!validateConditional(raw.visibleIf, declaredVars, declaredVarTypes, `${path}.visibleIf`, errors)) {
      return false
    }
  }
  return true
}

function validateSection(
  raw: unknown,
  declaredVars: Set<string>,
  declaredVarTypes: Map<string, FieldValueType>,
  path: string,
  limits: FlexCardLimits,
  errors: string[]
): FlexCardSection | null {
  if (!isPlainObject(raw)) {
    errors.push(`${path}: section must be an object`)
    return null
  }
  const id = raw.id
  if (!isValidIdentifier(id)) {
    errors.push(`${path}: section.id must be an identifier ≤ 64 chars`)
    return null
  }
  const title = raw.title
  if (typeof title !== "string" || title.length === 0) {
    errors.push(`${path}: section.title must be a non-empty string`)
    return null
  }
  if (title.length > limits.maxLabelChars) {
    errors.push(`${path}: section.title length exceeds ${limits.maxLabelChars}`)
    return null
  }
  if (!Array.isArray(raw.fields)) {
    errors.push(`${path}: section.fields must be an array`)
    return null
  }
  if (raw.fields.length === 0) {
    errors.push(`${path}: section.fields must be non-empty`)
    return null
  }
  if (raw.fields.length > limits.maxFieldsPerSection) {
    errors.push(
      `${path}: section has ${raw.fields.length} fields — exceeds maxFieldsPerSection ${limits.maxFieldsPerSection}`
    )
    return null
  }
  for (let i = 0; i < raw.fields.length; i++) {
    if (!validateField(raw.fields[i], declaredVars, declaredVarTypes, `${path}.fields[${i}]`, limits, errors)) {
      return null
    }
  }
  if (has(raw, "conditional")) {
    if (!validateConditional(raw.conditional, declaredVars, declaredVarTypes, `${path}.conditional`, errors)) {
      return null
    }
  }
  // Cast — runtime structural validation passed.
  return raw as unknown as FlexCardSection
}

export function validateFlexCardConfig(
  input: ValidateFlexCardInput
): ValidateFlexCardResult {
  const errors: string[] = []
  if (!isPlainObject(input.config)) {
    return { ok: false, errors: ["config must be a plain object"] }
  }
  const limits: FlexCardLimits = {
    ...DEFAULT_FLEX_CARD_LIMITS,
    ...(input.limits ?? {}),
  }
  // Negative-limit guard.
  for (const [k, v] of Object.entries(limits)) {
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
      errors.push(`limits.${k} must be a positive number`)
    }
  }
  if (errors.length > 0) return { ok: false, errors }

  const raw = input.config

  // 1. Declared variables — slice-1 allows field paths to act as
  // declared variables too (they resolve to object values at render).
  // We also track each declared name's valueType so the conditional
  // validator can reject date-typed conditionals at config time.
  const declaredVars = new Set<string>()
  const declaredVarTypes = new Map<string, FieldValueType>()
  if (has(raw, "variables")) {
    if (!Array.isArray(raw.variables)) {
      errors.push("config.variables must be an array")
      return { ok: false, errors }
    }
    for (let i = 0; i < raw.variables.length; i++) {
      const v = raw.variables[i]
      if (!isPlainObject(v)) {
        errors.push(`config.variables[${i}] must be an object`)
        return { ok: false, errors }
      }
      const name = v.name
      if (!isValidIdentifier(name)) {
        errors.push(`config.variables[${i}].name must be an identifier`)
        return { ok: false, errors }
      }
      if (FORBIDDEN_VAR_NAMES.has(name)) {
        errors.push(
          `config.variables[${i}].name "${name}" is reserved (JS prototype chain)`
        )
        return { ok: false, errors }
      }
      if (declaredVars.has(name)) {
        errors.push(`config.variables[${i}].name "${name}" is a duplicate`)
        return { ok: false, errors }
      }
      if (!(FIELD_VALUE_TYPES as readonly string[]).includes(v.type as FieldValueType)) {
        errors.push(`config.variables[${i}].type "${String(v.type)}" not in allowed types`)
        return { ok: false, errors }
      }
      declaredVars.add(name)
      declaredVarTypes.set(name, v.type as FieldValueType)
    }
  }

  // 2. Sections.
  if (!Array.isArray(raw.sections)) {
    errors.push("config.sections must be an array")
    return { ok: false, errors }
  }
  if (raw.sections.length === 0) {
    errors.push("config.sections must be non-empty")
    return { ok: false, errors }
  }
  if (raw.sections.length > limits.maxSections) {
    errors.push(
      `config has ${raw.sections.length} sections — exceeds maxSections ${limits.maxSections}`
    )
    return { ok: false, errors }
  }

  // 3. First pass: collect ALL field paths into declaredVars +
  // declaredVarTypes so sections can reference each other's paths
  // via conditional.var. Skip forbidden tokens at this step too —
  // they'll be caught again by validateField but rejecting them
  // here keeps declaredVars clean for conditional lookups.
  for (const s of raw.sections) {
    if (!isPlainObject(s) || !Array.isArray(s.fields)) continue
    for (const f of s.fields) {
      if (!isPlainObject(f) || typeof f.path !== "string") continue
      // Defense-in-depth: don't merge forbidden tokens into declaredVars
      // even pre-validation; validateField below will reject the field
      // entry but this prevents a hostile config from polluting the
      // lookup set if validateField is bypassed.
      const segments = f.path.split(".")
      if (segments.some((seg) => FORBIDDEN_VAR_NAMES.has(seg))) continue
      declaredVars.add(f.path)
      if (typeof f.valueType === "string" && (FIELD_VALUE_TYPES as readonly string[]).includes(f.valueType)) {
        declaredVarTypes.set(f.path, f.valueType as FieldValueType)
      }
    }
  }

  // 4. Second pass: validate each section + uniqueness check on IDs.
  const sectionIds = new Set<string>()
  let totalFieldCount = 0
  for (let i = 0; i < raw.sections.length; i++) {
    const s = validateSection(raw.sections[i], declaredVars, declaredVarTypes, `config.sections[${i}]`, limits, errors)
    if (!s) return { ok: false, errors }
    if (sectionIds.has(s.id)) {
      errors.push(`config.sections[${i}]: section id "${s.id}" is a duplicate`)
      return { ok: false, errors }
    }
    sectionIds.add(s.id)
    totalFieldCount += s.fields.length
  }
  if (totalFieldCount > limits.maxFieldsTotal) {
    errors.push(
      `total field count ${totalFieldCount} exceeds maxFieldsTotal ${limits.maxFieldsTotal}`
    )
    return { ok: false, errors }
  }

  return { ok: true, config: raw as unknown as FlexCardConfig }
}
