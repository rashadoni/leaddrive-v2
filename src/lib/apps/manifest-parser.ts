/**
 * Manifest parser — L1/L2 Phase 5 slice 1.
 *
 * Validates an `App.manifest` JSONB blob against the typed
 * `AppManifest` shape. Collects all errors before returning so the
 * UI can show every problem at once. Pure synchronous — no I/O.
 *
 * Slice 2 will reuse this for vendor-uploaded manifests (third-party
 * apps); slice 1 only consumes the first-party catalog seed which
 * we own, so the parser is mainly defence-in-depth + a forcing
 * function on the schema's shape.
 */
import { MODULE_REGISTRY } from "@/lib/modules"
import type {
  AppManifest,
  ManifestCustomField,
  ManifestEventSubscription,
  ManifestParseResult,
  ManifestRequirements,
  ManifestSettingKey,
  ManifestWebhookSubscription,
} from "./types"

// Lowercase-only identifier — DB columns are case-sensitive (unique
// indexes on customField (entityType, fieldName) etc.), so accepting
// `Stripe_Customer_Id` vs `stripe_customer_id` would let two manifests
// collide post-install. Slice 1 enforces lowercase identifiers
// across fieldName / settingsKey / refs.
const IDENT_RE = /^[a-z_][a-z0-9_]*$/
const REF_RE = /^[a-z_][a-z0-9_-]*$/

export function parseManifest(raw: unknown): ManifestParseResult {
  const errors: string[] = []
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["manifest must be an object"] }
  }
  const obj = raw as Record<string, unknown>

  // schemaVersion lock — only `1` is accepted in slice 1.
  if (obj.schemaVersion !== 1) {
    errors.push(`schemaVersion must be 1 (got ${JSON.stringify(obj.schemaVersion)})`)
  }

  const capabilitiesRaw = obj.capabilities
  if (!capabilitiesRaw || typeof capabilitiesRaw !== "object" || Array.isArray(capabilitiesRaw)) {
    return { ok: false, errors: [...errors, "manifest.capabilities must be an object"] }
  }
  const cap = capabilitiesRaw as Record<string, unknown>

  const customFields = parseOptionalArray<ManifestCustomField>(
    cap.customFields,
    "capabilities.customFields",
    parseCustomField,
    errors
  )
  const webhookSubscriptions = parseOptionalArray<ManifestWebhookSubscription>(
    cap.webhookSubscriptions,
    "capabilities.webhookSubscriptions",
    parseWebhookSubscription,
    errors
  )
  const eventSubscriptions = parseOptionalArray<ManifestEventSubscription>(
    cap.eventSubscriptions,
    "capabilities.eventSubscriptions",
    parseEventSubscription,
    errors
  )
  const settingsKeys = parseOptionalArray<ManifestSettingKey>(
    cap.settingsKeys,
    "capabilities.settingsKeys",
    parseSettingKey,
    errors
  )

  // Reject empty manifest (nothing to install — that's a caller bug).
  const totalCapabilities =
    (customFields?.length ?? 0) +
    (webhookSubscriptions?.length ?? 0) +
    (eventSubscriptions?.length ?? 0) +
    (settingsKeys?.length ?? 0)
  if (totalCapabilities === 0 && errors.length === 0) {
    errors.push("manifest must declare at least one capability")
  }

  // Slice 1 enforces ref uniqueness across webhook + event subscriptions
  // (caller-side `ref` is used by slice 2 to address the subscription
  // for update/uninstall; duplicate refs would silently overwrite).
  if (webhookSubscriptions && eventSubscriptions) {
    const allRefs = [
      ...webhookSubscriptions.map(s => s.ref),
      ...eventSubscriptions.map(s => s.ref),
    ]
    const seen = new Set<string>()
    for (const r of allRefs) {
      if (seen.has(r)) {
        errors.push(`duplicate subscription ref "${r}"`)
      }
      seen.add(r)
    }
  }

  let requirements: ManifestRequirements | undefined
  if (obj.requirements !== undefined) {
    requirements = parseRequirements(obj.requirements, errors)
  }

  if (errors.length > 0) return { ok: false, errors }

  const manifest: AppManifest = {
    schemaVersion: 1,
    capabilities: {
      customFields: customFields ?? undefined,
      webhookSubscriptions: webhookSubscriptions ?? undefined,
      eventSubscriptions: eventSubscriptions ?? undefined,
      settingsKeys: settingsKeys ?? undefined,
    },
    requirements,
  }
  return { ok: true, manifest }
}

/* ─── Per-entry parsers ──────────────────────────────────────────────── */

type ItemParser<T> = (raw: unknown, path: string, errors: string[]) => T | null

function parseOptionalArray<T>(
  raw: unknown,
  path: string,
  itemParser: ItemParser<T>,
  errors: string[]
): T[] | null {
  if (raw === undefined) return null
  if (!Array.isArray(raw)) {
    errors.push(`${path} must be an array`)
    return null
  }
  const out: T[] = []
  for (let i = 0; i < raw.length; i++) {
    const item = itemParser(raw[i], `${path}[${i}]`, errors)
    if (item) out.push(item)
  }
  return out
}

function parseCustomField(raw: unknown, path: string, errors: string[]): ManifestCustomField | null {
  if (!raw || typeof raw !== "object") {
    errors.push(`${path} must be an object`)
    return null
  }
  const o = raw as Record<string, unknown>
  const entityType = requireString(o.entityType, `${path}.entityType`, errors, IDENT_RE)
  const fieldName = requireString(o.fieldName, `${path}.fieldName`, errors, IDENT_RE)
  const fieldLabel = requireString(o.fieldLabel, `${path}.fieldLabel`, errors)
  const fieldType = o.fieldType
  if (
    fieldType !== "string" &&
    fieldType !== "number" &&
    fieldType !== "boolean" &&
    fieldType !== "date" &&
    fieldType !== "select"
  ) {
    errors.push(`${path}.fieldType — unknown value ${JSON.stringify(fieldType)}`)
    return null
  }
  if (typeof o.required !== "boolean") {
    errors.push(`${path}.required must be boolean`)
    return null
  }
  let options: string[] | undefined
  if (fieldType === "select") {
    if (!Array.isArray(o.options) || o.options.length === 0) {
      errors.push(`${path}.options — select fields require non-empty array of strings`)
      return null
    }
    // Reject non-string AND empty-string options; an empty option in a
    // dropdown is a silent display bug that's hard to debug later.
    if (o.options.some(v => typeof v !== "string" || v.length === 0)) {
      errors.push(`${path}.options — all values must be non-empty strings`)
      return null
    }
    options = o.options as string[]
  } else if (o.options !== undefined) {
    errors.push(`${path}.options — only valid for select fields`)
    return null
  }
  if (!entityType || !fieldName || !fieldLabel) return null
  return {
    entityType,
    fieldName,
    fieldLabel,
    fieldType,
    required: o.required,
    options,
  }
}

function parseWebhookSubscription(
  raw: unknown,
  path: string,
  errors: string[]
): ManifestWebhookSubscription | null {
  if (!raw || typeof raw !== "object") {
    errors.push(`${path} must be an object`)
    return null
  }
  const o = raw as Record<string, unknown>
  const ref = requireString(o.ref, `${path}.ref`, errors, REF_RE)
  if (!Array.isArray(o.eventNames) || o.eventNames.length === 0) {
    errors.push(`${path}.eventNames — must be a non-empty array of strings`)
    return null
  }
  if (o.eventNames.some(v => typeof v !== "string" || !v)) {
    errors.push(`${path}.eventNames — all entries must be non-empty strings`)
    return null
  }
  const targetUrl = requireString(o.targetUrl, `${path}.targetUrl`, errors)
  if (targetUrl && !/^https:\/\//.test(targetUrl)) {
    errors.push(`${path}.targetUrl must be https://`)
  }
  let credentialRef: string | undefined
  if (o.credentialRef !== undefined) {
    if (typeof o.credentialRef !== "string" || !IDENT_RE.test(o.credentialRef)) {
      errors.push(`${path}.credentialRef must be a valid identifier`)
    } else {
      credentialRef = o.credentialRef
    }
  }
  if (!ref || !targetUrl) return null
  return {
    ref,
    eventNames: o.eventNames as string[],
    targetUrl,
    credentialRef,
  }
}

function parseEventSubscription(
  raw: unknown,
  path: string,
  errors: string[]
): ManifestEventSubscription | null {
  if (!raw || typeof raw !== "object") {
    errors.push(`${path} must be an object`)
    return null
  }
  const o = raw as Record<string, unknown>
  const ref = requireString(o.ref, `${path}.ref`, errors, REF_RE)
  const eventName = requireString(o.eventName, `${path}.eventName`, errors, IDENT_RE)
  let codeModuleSlug: string | undefined
  if (o.codeModuleSlug !== undefined) {
    if (typeof o.codeModuleSlug !== "string" || !IDENT_RE.test(o.codeModuleSlug)) {
      errors.push(`${path}.codeModuleSlug must be a valid identifier`)
    } else {
      codeModuleSlug = o.codeModuleSlug
    }
  }
  if (!ref || !eventName) return null
  return { ref, eventName, codeModuleSlug }
}

function parseSettingKey(raw: unknown, path: string, errors: string[]): ManifestSettingKey | null {
  if (!raw || typeof raw !== "object") {
    errors.push(`${path} must be an object`)
    return null
  }
  const o = raw as Record<string, unknown>
  const key = requireString(o.key, `${path}.key`, errors, IDENT_RE)
  const label = requireString(o.label, `${path}.label`, errors)
  const type = o.type
  if (type !== "string" && type !== "number" && type !== "boolean" && type !== "secret") {
    errors.push(`${path}.type — unknown value ${JSON.stringify(type)}`)
    return null
  }
  if (typeof o.required !== "boolean") {
    errors.push(`${path}.required must be boolean`)
    return null
  }
  let defaultValue: string | number | boolean | undefined
  if (o.defaultValue !== undefined) {
    if (
      typeof o.defaultValue !== "string" &&
      typeof o.defaultValue !== "number" &&
      typeof o.defaultValue !== "boolean"
    ) {
      errors.push(`${path}.defaultValue must be scalar (string/number/boolean)`)
    } else {
      defaultValue = o.defaultValue
    }
  }
  // A required setting with a defaultValue is contradictory — the
  // planner would silently apply the default and never error on
  // missing input, defeating the "required" semantic. Surface the
  // contradiction at parse time so manifest authors fix it.
  if (o.required === true && defaultValue !== undefined) {
    errors.push(
      `${path} — required:true is incompatible with defaultValue (defaults imply non-required)`
    )
    return null
  }
  if (!key || !label) return null
  return { key, label, type, required: o.required, defaultValue }
}

function parseRequirements(raw: unknown, errors: string[]): ManifestRequirements | undefined {
  if (raw === null) return undefined
  if (typeof raw !== "object" || Array.isArray(raw)) {
    errors.push("requirements must be an object")
    return undefined
  }
  const o = raw as Record<string, unknown>
  let namedCredentialNames: string[] | undefined
  let modules: string[] | undefined
  if (o.namedCredentialNames !== undefined) {
    if (
      !Array.isArray(o.namedCredentialNames) ||
      o.namedCredentialNames.some(v => typeof v !== "string" || !v)
    ) {
      errors.push("requirements.namedCredentialNames must be array of non-empty strings")
    } else {
      namedCredentialNames = o.namedCredentialNames as string[]
    }
  }
  if (o.modules !== undefined) {
    if (
      !Array.isArray(o.modules) ||
      o.modules.some(v => typeof v !== "string" || !v)
    ) {
      errors.push("requirements.modules must be array of non-empty strings")
    } else {
      // Fail fast on module names that aren't in the registry — at
      // install time these would silently land in the "missing" list
      // (since hasModule returns false for unknown ids), which is
      // confusing UX. Reject at parse time so manifest authors see
      // the typo immediately.
      const unknown = (o.modules as string[]).filter(
        m => !(m in MODULE_REGISTRY)
      )
      if (unknown.length > 0) {
        errors.push(
          `requirements.modules — unknown module id(s): ${unknown.join(", ")}`
        )
      } else {
        modules = o.modules as string[]
      }
    }
  }
  return { namedCredentialNames, modules }
}

function requireString(
  value: unknown,
  path: string,
  errors: string[],
  regex?: RegExp
): string {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${path} must be a non-empty string`)
    return ""
  }
  if (regex && !regex.test(value)) {
    errors.push(`${path} — value "${value}" doesn't match required pattern`)
    return ""
  }
  return value
}
