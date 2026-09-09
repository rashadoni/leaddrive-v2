/**
 * Install-plan generator — L1/L2 Phase 5 slice 1.
 *
 * Translates a parsed `AppManifest` + user-supplied install-time
 * config into a concrete `InstallPlan` (list of `InstallAction`s).
 *
 * Slice 1 builds + validates the plan. Slice 2's executor consumes
 * the plan inside a transaction:
 *   - create_custom_field             → INSERT CustomField row
 *   - register_webhook_subscription   → INSERT Webhook subscription
 *   - register_event_subscription     → INSERT event-bus listener row
 *   - set_setting                     → write into AppInstallation.config
 *
 * Pure synchronous — no I/O.
 */
import type {
  AppManifest,
  InstallAction,
  InstallPlan,
  ManifestSettingKey,
} from "./types"

export interface BuildInstallPlanInput {
  /** The catalog App row's primary key. */
  appId: string
  /** Slug — denormalised onto the plan so the action runner can log it. */
  appSlug: string
  /** Version being installed — pinned onto AppInstallation.installedVersion. */
  installedVersion: string
  /** Parsed manifest (already passed parseManifest). */
  manifest: AppManifest
  /** Tenant-supplied settings values keyed by manifest.settingsKeys. */
  userConfig: Record<string, unknown>
}

export interface BuildInstallPlanFail {
  ok: false
  errors: string[]
}

export interface BuildInstallPlanOk {
  ok: true
  plan: InstallPlan
}

export type BuildInstallPlanResult = BuildInstallPlanOk | BuildInstallPlanFail

export function buildInstallPlan(input: BuildInstallPlanInput): BuildInstallPlanResult {
  const errors: string[] = []
  const cap = input.manifest.capabilities
  const actions: InstallAction[] = []

  // Validate user-supplied config against settingsKeys + collect
  // missing-required errors.
  const resolvedConfig: Record<string, unknown> = {}
  const settingsKeys = cap.settingsKeys ?? []
  const knownKeys = new Set(settingsKeys.map(s => s.key))
  for (const key of Object.keys(input.userConfig)) {
    if (!knownKeys.has(key)) {
      errors.push(`config contains unknown setting "${key}"`)
    }
  }
  for (const spec of settingsKeys) {
    const provided = input.userConfig[spec.key]
    const present = provided !== undefined && provided !== null
    if (!present) {
      if (spec.defaultValue !== undefined) {
        resolvedConfig[spec.key] = spec.defaultValue
        actions.push({
          kind: "set_setting",
          key: spec.key,
          value: spec.defaultValue,
        })
      } else if (spec.required) {
        errors.push(`missing required setting "${spec.key}"`)
      }
      continue
    }
    const coerced = coerceSetting(spec, provided, errors)
    if (coerced !== undefined) {
      resolvedConfig[spec.key] = coerced
      actions.push({ kind: "set_setting", key: spec.key, value: coerced })
    }
  }

  for (const cf of cap.customFields ?? []) {
    actions.push({ kind: "create_custom_field", spec: cf })
  }
  for (const ws of cap.webhookSubscriptions ?? []) {
    actions.push({ kind: "register_webhook_subscription", spec: ws })
  }
  for (const es of cap.eventSubscriptions ?? []) {
    actions.push({ kind: "register_event_subscription", spec: es })
  }

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    plan: {
      appId: input.appId,
      appSlug: input.appSlug,
      installedVersion: input.installedVersion,
      actions,
      config: resolvedConfig,
    },
  }
}

function coerceSetting(
  spec: ManifestSettingKey,
  value: unknown,
  errors: string[]
): string | number | boolean | undefined {
  switch (spec.type) {
    case "string":
    case "secret": {
      if (typeof value !== "string") {
        errors.push(`setting "${spec.key}" must be a string`)
        return undefined
      }
      return value
    }
    case "number": {
      if (typeof value === "number" && Number.isFinite(value)) return value
      if (typeof value === "string") {
        const n = Number(value.trim())
        if (Number.isFinite(n)) return n
      }
      errors.push(`setting "${spec.key}" must be a finite number`)
      return undefined
    }
    case "boolean": {
      if (typeof value === "boolean") return value
      if (value === "true") return true
      if (value === "false") return false
      errors.push(`setting "${spec.key}" must be a boolean`)
      return undefined
    }
    default: {
      const exhaustive: never = spec.type
      throw new Error(`Unhandled setting type: ${exhaustive}`)
    }
  }
}
