/**
 * OmniScript graph validator — N16 Phase 6 Block D slice 2.
 *
 * Validates an OmniScript step graph (a DAG of steps connected by
 * nextStepId / conditional branches). Enforces:
 *   • Structural shape per step type (input / api_call / conditional /
 *     action — each has its own config schema).
 *   • startStepId references a real step.
 *   • Every nextStepId / branch.nextStepId / defaultNextStepId resolves
 *     to a real step.
 *   • No cycles (DFS-based detection).
 *   • Reachable subset = all steps reachable from startStepId; unused
 *     steps are FLAGGED (warning, not rejection — slice-2 may want
 *     "draft mode" where unwired steps coexist).
 *   • Step IDs unique within the script.
 *   • Conditional branch count + arg keys within bounds.
 *
 * Pure synchronous.
 */
import {
  DEFAULT_OMNI_SCRIPT_LIMITS,
  FIELD_VALUE_TYPES,
  STEP_TYPES,
  type FieldValueType,
  type OmniScriptConfig,
  type OmniScriptLimits,
  type ScriptStep,
  type StepType,
  type ValidateOmniScriptInput,
  type ValidateOmniScriptResult,
} from "./types"

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function has(o: Record<string, unknown>, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k)
}

const ALLOWED_HTTP_METHODS = new Set(["GET", "POST", "PUT", "DELETE"])
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"])

function isValidStepId(s: unknown, maxChars: number): s is string {
  return typeof s === "string" && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(s) && s.length <= maxChars
}

function validateInputConfig(
  cfg: unknown,
  path: string,
  errors: string[]
): boolean {
  if (!isPlainObject(cfg)) {
    errors.push(`${path}: input.config must be an object`)
    return false
  }
  if (!has(cfg, "storeAs") || typeof cfg.storeAs !== "string" || cfg.storeAs.length === 0) {
    errors.push(`${path}: input.config.storeAs must be a non-empty string`)
    return false
  }
  if (FORBIDDEN_KEYS.has(cfg.storeAs)) {
    errors.push(`${path}: input.config.storeAs "${cfg.storeAs}" is reserved`)
    return false
  }
  if (!(FIELD_VALUE_TYPES as readonly string[]).includes(cfg.fieldType as FieldValueType)) {
    errors.push(`${path}: input.config.fieldType "${String(cfg.fieldType)}" not in allowed types`)
    return false
  }
  if (typeof cfg.required !== "boolean") {
    errors.push(`${path}: input.config.required must be boolean`)
    return false
  }
  if (has(cfg, "prompt") && typeof cfg.prompt !== "string") {
    errors.push(`${path}: input.config.prompt must be a string`)
    return false
  }
  return true
}

function validateApiCallConfig(
  cfg: unknown,
  path: string,
  errors: string[]
): boolean {
  if (!isPlainObject(cfg)) {
    errors.push(`${path}: api_call.config must be an object`)
    return false
  }
  if (!ALLOWED_HTTP_METHODS.has(cfg.method as string)) {
    errors.push(`${path}: api_call.config.method must be GET/POST/PUT/DELETE`)
    return false
  }
  if (typeof cfg.urlTemplate !== "string" || cfg.urlTemplate.length === 0) {
    errors.push(`${path}: api_call.config.urlTemplate must be a non-empty string`)
    return false
  }
  if (cfg.urlTemplate.length > 2048) {
    errors.push(`${path}: api_call.config.urlTemplate length exceeds 2048`)
    return false
  }
  if (typeof cfg.storeAs !== "string" || cfg.storeAs.length === 0) {
    errors.push(`${path}: api_call.config.storeAs must be a non-empty string`)
    return false
  }
  if (FORBIDDEN_KEYS.has(cfg.storeAs)) {
    errors.push(`${path}: api_call.config.storeAs "${cfg.storeAs}" is reserved`)
    return false
  }
  // bodyTemplate is optional; no shape validation here — slice-2 runtime
  // interpolates `${var}` against session state.
  return true
}

function validateConditionalConfig(
  cfg: unknown,
  path: string,
  limits: OmniScriptLimits,
  errors: string[]
): boolean {
  if (!isPlainObject(cfg)) {
    errors.push(`${path}: conditional.config must be an object`)
    return false
  }
  if (!Array.isArray(cfg.branches)) {
    errors.push(`${path}: conditional.config.branches must be an array`)
    return false
  }
  if (cfg.branches.length === 0) {
    errors.push(`${path}: conditional.config.branches must be non-empty`)
    return false
  }
  if (cfg.branches.length > limits.maxBranchesPerConditional) {
    errors.push(
      `${path}: conditional has ${cfg.branches.length} branches — exceeds ${limits.maxBranchesPerConditional}`
    )
    return false
  }
  for (let i = 0; i < cfg.branches.length; i++) {
    const b = cfg.branches[i]
    if (!isPlainObject(b)) {
      errors.push(`${path}: branches[${i}] must be an object`)
      return false
    }
    if (typeof b.var !== "string" || b.var.length === 0) {
      errors.push(`${path}: branches[${i}].var must be a non-empty string`)
      return false
    }
    if (FORBIDDEN_KEYS.has(b.var)) {
      errors.push(`${path}: branches[${i}].var "${b.var}" is reserved`)
      return false
    }
    if (typeof b.equals !== "string" && typeof b.equals !== "number" && typeof b.equals !== "boolean") {
      errors.push(`${path}: branches[${i}].equals must be string | number | boolean`)
      return false
    }
    if (typeof b.nextStepId !== "string" || b.nextStepId.length === 0) {
      errors.push(`${path}: branches[${i}].nextStepId must be a non-empty string`)
      return false
    }
  }
  if (typeof cfg.defaultNextStepId !== "string" || cfg.defaultNextStepId.length === 0) {
    errors.push(`${path}: conditional.config.defaultNextStepId must be a non-empty string`)
    return false
  }
  return true
}

function validateActionConfig(
  cfg: unknown,
  path: string,
  limits: OmniScriptLimits,
  errors: string[]
): boolean {
  if (!isPlainObject(cfg)) {
    errors.push(`${path}: action.config must be an object`)
    return false
  }
  if (typeof cfg.actionKey !== "string" || cfg.actionKey.length === 0) {
    errors.push(`${path}: action.config.actionKey must be a non-empty string`)
    return false
  }
  if (has(cfg, "args")) {
    if (!isPlainObject(cfg.args)) {
      errors.push(`${path}: action.config.args must be an object`)
      return false
    }
    const keys = Object.keys(cfg.args)
    if (keys.length > limits.maxArgKeys) {
      errors.push(
        `${path}: action.config.args has ${keys.length} keys — exceeds ${limits.maxArgKeys}`
      )
      return false
    }
    for (const k of keys) {
      if (FORBIDDEN_KEYS.has(k)) {
        errors.push(`${path}: action.config.args key "${k}" is reserved`)
        return false
      }
    }
  }
  return true
}

interface StepGraphInternal {
  byId: Map<string, ScriptStep>
  /** outbound[stepId] = [nextStepId, ...] for cycle detection */
  outbound: Map<string, string[]>
}

function buildGraph(steps: readonly ScriptStep[]): StepGraphInternal {
  const byId = new Map<string, ScriptStep>()
  const outbound = new Map<string, string[]>()
  for (const s of steps) {
    byId.set(s.id, s)
    const outs: string[] = []
    if (s.type === "conditional") {
      for (const b of s.config.branches) outs.push(b.nextStepId)
      outs.push(s.config.defaultNextStepId)
    } else if (s.nextStepId) {
      outs.push(s.nextStepId)
    }
    outbound.set(s.id, outs)
  }
  return { byId, outbound }
}

function detectCycle(graph: StepGraphInternal, startId: string): string | null {
  // DFS with WHITE / GRAY / BLACK coloring. Returns the cycle-causing
  // edge as a "fromId → toId" string, or null if no cycle.
  const color = new Map<string, "white" | "gray" | "black">()
  for (const id of graph.byId.keys()) color.set(id, "white")
  const stack: Array<{ id: string; idx: number }> = [{ id: startId, idx: 0 }]
  color.set(startId, "gray")
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]
    const outs = graph.outbound.get(frame.id) ?? []
    if (frame.idx >= outs.length) {
      color.set(frame.id, "black")
      stack.pop()
      continue
    }
    const next = outs[frame.idx]
    frame.idx += 1
    const nextColor = color.get(next)
    if (nextColor === "gray") {
      return `${frame.id} → ${next}`
    }
    if (nextColor === "white") {
      color.set(next, "gray")
      stack.push({ id: next, idx: 0 })
    }
    // black: already fully explored, skip.
  }
  return null
}

function reachable(graph: StepGraphInternal, startId: string): Set<string> {
  const visited = new Set<string>()
  const stack: string[] = [startId]
  while (stack.length > 0) {
    const id = stack.pop()!
    if (visited.has(id)) continue
    visited.add(id)
    const outs = graph.outbound.get(id) ?? []
    for (const o of outs) stack.push(o)
  }
  return visited
}

export function validateOmniScriptConfig(
  input: ValidateOmniScriptInput
): ValidateOmniScriptResult {
  const errors: string[] = []
  if (!isPlainObject(input.config)) {
    return { ok: false, errors: ["config must be a plain object"] }
  }
  const limits: OmniScriptLimits = {
    ...DEFAULT_OMNI_SCRIPT_LIMITS,
    ...(input.limits ?? {}),
  }
  for (const [k, v] of Object.entries(limits)) {
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
      errors.push(`limits.${k} must be a positive number`)
    }
  }
  if (errors.length > 0) return { ok: false, errors }

  const raw = input.config

  // 1. startStepId.
  if (typeof raw.startStepId !== "string" || raw.startStepId.length === 0) {
    return { ok: false, errors: ["config.startStepId must be a non-empty string"] }
  }

  // 2. Steps array.
  if (!Array.isArray(raw.steps)) {
    return { ok: false, errors: ["config.steps must be an array"] }
  }
  if (raw.steps.length === 0) {
    return { ok: false, errors: ["config.steps must be non-empty"] }
  }
  if (raw.steps.length > limits.maxSteps) {
    return {
      ok: false,
      errors: [`config has ${raw.steps.length} steps — exceeds maxSteps ${limits.maxSteps}`],
    }
  }

  // 3. Per-step validation + uniqueness.
  const ids = new Set<string>()
  const validatedSteps: ScriptStep[] = []
  for (let i = 0; i < raw.steps.length; i++) {
    const s = raw.steps[i]
    const path = `config.steps[${i}]`
    if (!isPlainObject(s)) {
      errors.push(`${path}: step must be an object`)
      return { ok: false, errors }
    }
    if (!isValidStepId(s.id, limits.maxStepIdChars)) {
      errors.push(`${path}: step.id must be an identifier ≤ ${limits.maxStepIdChars} chars`)
      return { ok: false, errors }
    }
    if (ids.has(s.id)) {
      errors.push(`${path}: step.id "${s.id}" is a duplicate`)
      return { ok: false, errors }
    }
    ids.add(s.id)
    if (!(STEP_TYPES as readonly string[]).includes(s.type as StepType)) {
      errors.push(`${path}: step.type "${String(s.type)}" not in allowed types`)
      return { ok: false, errors }
    }
    if (has(s, "nextStepId")) {
      // Match step.id's shape — same identifier regex + length cap.
      // Architect-pass-1 close-out: silently accepting a 100KB string
      // here only failed at the unresolved-id check, which is a worse
      // error surface than rejecting up front.
      if (!isValidStepId(s.nextStepId, limits.maxStepIdChars)) {
        errors.push(`${path}: step.nextStepId must be an identifier ≤ ${limits.maxStepIdChars} chars`)
        return { ok: false, errors }
      }
    }
    // Per-type config validation.
    let configOk = false
    switch (s.type) {
      case "input":
        configOk = validateInputConfig(s.config, `${path}.config`, errors)
        break
      case "api_call":
        configOk = validateApiCallConfig(s.config, `${path}.config`, errors)
        break
      case "conditional":
        configOk = validateConditionalConfig(s.config, `${path}.config`, limits, errors)
        break
      case "action":
        configOk = validateActionConfig(s.config, `${path}.config`, limits, errors)
        break
    }
    if (!configOk) return { ok: false, errors }
    // Cast — runtime structural check passed.
    validatedSteps.push(s as unknown as ScriptStep)
  }

  // 4. startStepId resolves.
  if (!ids.has(raw.startStepId)) {
    errors.push(`config.startStepId "${raw.startStepId}" does not match any step.id`)
    return { ok: false, errors }
  }

  // 5. All next-step references resolve.
  for (const s of validatedSteps) {
    const path = `step "${s.id}"`
    if (s.type === "conditional") {
      for (let i = 0; i < s.config.branches.length; i++) {
        const b = s.config.branches[i]
        if (!ids.has(b.nextStepId)) {
          errors.push(`${path}.branches[${i}].nextStepId "${b.nextStepId}" does not resolve`)
          return { ok: false, errors }
        }
      }
      if (!ids.has(s.config.defaultNextStepId)) {
        errors.push(`${path}.defaultNextStepId "${s.config.defaultNextStepId}" does not resolve`)
        return { ok: false, errors }
      }
    } else if (s.nextStepId) {
      if (!ids.has(s.nextStepId)) {
        errors.push(`${path}.nextStepId "${s.nextStepId}" does not resolve`)
        return { ok: false, errors }
      }
    }
  }

  // 6. Cycle detection.
  const graph = buildGraph(validatedSteps)
  const cycle = detectCycle(graph, raw.startStepId)
  if (cycle !== null) {
    errors.push(`step graph contains a cycle: ${cycle}`)
    return { ok: false, errors }
  }

  // 7. Unreachable detection — non-fatal for slice 1, but flag as
  // error so drafts can't be published with dead steps. Slice-2 may
  // relax to "warning" for draft status.
  const reach = reachable(graph, raw.startStepId)
  const unreached = validatedSteps.filter((s) => !reach.has(s.id))
  if (unreached.length > 0) {
    errors.push(
      `unreachable step(s) from startStepId: ${unreached.map((s) => s.id).join(", ")}`
    )
    return { ok: false, errors }
  }

  return {
    ok: true,
    config: {
      startStepId: raw.startStepId,
      steps: validatedSteps,
    } as OmniScriptConfig,
  }
}
