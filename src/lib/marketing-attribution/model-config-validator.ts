/**
 * C9 model-config-validator — slice-1 pure helper.
 *
 * Validates the JSONB `config` column on attribution_models per its
 * declared modelType. Slice-2 admin API uses this to reject bad configs
 * before persisting; slice-2 worker uses it to refuse to run a model
 * with corrupt config.
 *
 * Pure function — no DB, no clock.
 */

import {
  ATTRIBUTION_MODEL_TYPES,
  MODEL_STATUSES,
  MODEL_STATUS_TRANSITIONS,
  RUN_STATUSES,
  RUN_STATUS_TRANSITIONS,
  U_SHAPED_WEIGHT_SUM_TOLERANCE,
  type AttributionModelType,
  type CustomConfig,
  type ModelStatus,
  type RunStatus,
  type TimeDecayConfig,
  type UShapedConfig,
} from "./types"

export interface ConfigValidationOk {
  ok: true
}

export interface ConfigValidationError {
  ok: false
  code:
    | "unknown_model_type"
    | "type_mismatch"
    | "missing_field"
    | "invalid_field_value"
    | "weights_do_not_sum"
    | "custom_curve_empty"
    | "custom_curve_invalid"
  message: string
  field?: string
}

export type ConfigValidationResult = ConfigValidationOk | ConfigValidationError

const OK: ConfigValidationOk = { ok: true }

/**
 * Validate a model config against the model's declared type.
 *
 *   first_touch / last_touch / linear → config is unused (empty object).
 *   time_decay → halfLifeDays must be positive finite number.
 *   u_shaped   → three weights must each be ≥0 and ≤1, sum within tolerance of 1.0.
 *   custom     → curve must be non-empty, positions in [0,1], weights >0.
 */
export function validateModelConfig(
  modelType: AttributionModelType,
  config: unknown,
): ConfigValidationResult {
  if (!ATTRIBUTION_MODEL_TYPES.includes(modelType)) {
    return {
      ok: false,
      code: "unknown_model_type",
      message: `unknown modelType "${modelType}"`,
    }
  }
  // All configs must be plain objects (DB column is JSONB).
  if (!isPlainObject(config)) {
    return {
      ok: false,
      code: "type_mismatch",
      message: "config must be a plain object",
    }
  }
  switch (modelType) {
    case "first_touch":
    case "last_touch":
    case "linear":
      // No knobs — accept empty {} (any extra keys ignored, pass-through).
      return OK
    case "time_decay":
      return validateTimeDecay(config)
    case "u_shaped":
      return validateUShaped(config)
    case "custom":
      return validateCustom(config)
    default:
      return {
        ok: false,
        code: "unknown_model_type",
        message: `unknown modelType "${String(modelType)}"`,
      }
  }
}

function validateTimeDecay(config: object): ConfigValidationResult {
  const cfg = config as Partial<TimeDecayConfig>
  if (cfg.halfLifeDays === undefined) {
    return {
      ok: false,
      code: "missing_field",
      message: "time_decay config requires halfLifeDays",
      field: "halfLifeDays",
    }
  }
  if (
    typeof cfg.halfLifeDays !== "number" ||
    !Number.isFinite(cfg.halfLifeDays) ||
    cfg.halfLifeDays <= 0
  ) {
    return {
      ok: false,
      code: "invalid_field_value",
      message: "halfLifeDays must be a positive finite number",
      field: "halfLifeDays",
    }
  }
  return OK
}

function validateUShaped(config: object): ConfigValidationResult {
  const cfg = config as Partial<UShapedConfig>
  for (const field of ["firstWeight", "lastWeight", "middleWeight"] as const) {
    const value = cfg[field]
    if (value === undefined) {
      return {
        ok: false,
        code: "missing_field",
        message: `u_shaped config requires ${field}`,
        field,
      }
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return {
        ok: false,
        code: "invalid_field_value",
        message: `${field} must be a non-negative finite number`,
        field,
      }
    }
    if (value > 1) {
      return {
        ok: false,
        code: "invalid_field_value",
        message: `${field} must be ≤ 1.0`,
        field,
      }
    }
  }
  const sum =
    (cfg.firstWeight ?? 0) + (cfg.lastWeight ?? 0) + (cfg.middleWeight ?? 0)
  if (Math.abs(sum - 1) > U_SHAPED_WEIGHT_SUM_TOLERANCE) {
    return {
      ok: false,
      code: "weights_do_not_sum",
      message: `u_shaped weights must sum to 1.0 (got ${sum.toFixed(6)})`,
    }
  }
  return OK
}

function validateCustom(config: object): ConfigValidationResult {
  const cfg = config as Partial<CustomConfig>
  if (!Array.isArray(cfg.curve)) {
    return {
      ok: false,
      code: "missing_field",
      message: "custom config requires curve array",
      field: "curve",
    }
  }
  if (cfg.curve.length === 0) {
    return {
      ok: false,
      code: "custom_curve_empty",
      message: "custom curve must have at least one point",
      field: "curve",
    }
  }
  for (let i = 0; i < cfg.curve.length; i++) {
    const point = cfg.curve[i] as { position?: unknown; weight?: unknown }
    if (
      typeof point.position !== "number" ||
      !Number.isFinite(point.position) ||
      point.position < 0 ||
      point.position > 1
    ) {
      return {
        ok: false,
        code: "custom_curve_invalid",
        message: `custom curve[${i}].position must be a number in [0,1]`,
        field: `curve[${i}].position`,
      }
    }
    if (
      typeof point.weight !== "number" ||
      !Number.isFinite(point.weight) ||
      point.weight <= 0
    ) {
      // Strict `> 0` by design: the custom-curve authoring UI (#13) shipped and
      // enforces positive weights too. renormalize() in the evaluator could
      // technically handle zeros, but rejecting them keeps every control point
      // meaningful and avoids degenerate all-zero curves. Duplicate positions
      // are allowed — interpolateCurve() resolves ties by taking the left point.
      return {
        ok: false,
        code: "custom_curve_invalid",
        message: `custom curve[${i}].weight must be a positive number`,
        field: `curve[${i}].weight`,
      }
    }
  }
  return OK
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  )
}

// ── State-machine helpers (mirror DB triggers) ──────────────────

export function isModelStatus(value: unknown): value is ModelStatus {
  return typeof value === "string" && MODEL_STATUSES.includes(value as ModelStatus)
}

export function canTransitionModelStatus(
  current: ModelStatus,
  next: ModelStatus,
): boolean {
  if (current === next) return true
  return MODEL_STATUS_TRANSITIONS[current].includes(next)
}

export function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === "string" && RUN_STATUSES.includes(value as RunStatus)
}

export function canTransitionRunStatus(
  current: RunStatus,
  next: RunStatus,
): boolean {
  if (current === next) return true
  return RUN_STATUS_TRANSITIONS[current].includes(next)
}

export function isCanonicalAttributionModelType(
  value: unknown,
): value is AttributionModelType {
  return (
    typeof value === "string" &&
    ATTRIBUTION_MODEL_TYPES.includes(value as AttributionModelType)
  )
}
