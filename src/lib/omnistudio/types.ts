/**
 * OmniStudio types — N16 Phase 6 Block D slice 2.
 *
 * Salesforce OmniStudio analogue. Shared shape between 5 pure helpers:
 *   1. state-machine          — FlexCard + OmniScript + session lifecycle
 *   2. flex-card-validator    — FlexCard config shape + invariants
 *   3. omni-script-validator  — OmniScript step graph DAG validation
 *   4. flex-card-renderer     — flatten card config → render tree
 *   5. (re-exported)          — typed I/O for slice-2 runtime
 *
 * Pure — no Prisma imports.
 */

/* ─── FlexCard / OmniScript publish lifecycle (shared) ────────────────── */

export const ARTIFACT_STATUSES = ["draft", "published", "archived"] as const
export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number]

/**
 *   draft → published / archived
 *   published → draft / archived
 *   archived → []
 *
 * Same shape as N2 Lightning App Builder page lifecycle — kept
 * parallel intentionally so admins can mental-model the two builders
 * identically.
 */
export const ARTIFACT_TRANSITIONS: Readonly<
  Record<ArtifactStatus, readonly ArtifactStatus[]>
> = {
  draft: ["published", "archived"],
  published: ["draft", "archived"],
  archived: [],
}

/* ─── Session lifecycle ───────────────────────────────────────────────── */

export const SESSION_STATUSES = [
  "in_progress",
  "completed",
  "abandoned",
  "failed",
] as const

export type SessionStatus = (typeof SESSION_STATUSES)[number]

/**
 *   in_progress → completed | abandoned | failed
 *   terminal → []
 */
export const SESSION_TRANSITIONS: Readonly<
  Record<SessionStatus, readonly SessionStatus[]>
> = {
  in_progress: ["completed", "abandoned", "failed"],
  completed: [],
  abandoned: [],
  failed: [],
}

/* ─── FlexCard config shape ───────────────────────────────────────────── */

export const FIELD_VALUE_TYPES = [
  "string",
  "number",
  "boolean",
  "date",
  "currency",
  "url",
] as const
export type FieldValueType = (typeof FIELD_VALUE_TYPES)[number]

export interface FlexCardField {
  /** Object-field path — e.g. "name", "company.name", "totalSpent". */
  path: string
  /** Display label. */
  label: string
  /** Hint for renderer; slice-2 may add formatter per type. */
  valueType: FieldValueType
  /** Optional flag to hide a field conditionally; conditional checked against section.variables. */
  visibleIf?: FlexCardConditional
}

export interface FlexCardConditional {
  /** Variable name referenced. Slice-2 runtime resolves from object/state. */
  var: string
  /** Equality value. */
  equals: string | number | boolean
}

export interface FlexCardSection {
  /** Unique within card. */
  id: string
  title: string
  /** Fields rendered in this section. Order matters. */
  fields: readonly FlexCardField[]
  /** Optional render-gate at the section level. */
  conditional?: FlexCardConditional
}

export interface FlexCardConfig {
  /** Top-level sections, ordered. */
  sections: readonly FlexCardSection[]
  /**
   * Optional helper variable declarations. Slice-2 runtime accepts
   * caller-supplied values for these alongside object fields when
   * resolving conditionals.
   */
  variables?: readonly { name: string; type: FieldValueType }[]
}

/* ─── FlexCard validator I/O ──────────────────────────────────────────── */

export interface ValidateFlexCardInput {
  config: unknown
  /** Optional bounds override (defaults from `DEFAULT_FLEX_CARD_LIMITS`). */
  limits?: Partial<FlexCardLimits>
}

export interface FlexCardLimits {
  maxSections: number
  maxFieldsPerSection: number
  maxFieldsTotal: number
  maxFieldPathChars: number
  maxLabelChars: number
}

export const DEFAULT_FLEX_CARD_LIMITS: Readonly<FlexCardLimits> = {
  maxSections: 16,
  maxFieldsPerSection: 32,
  maxFieldsTotal: 200,
  maxFieldPathChars: 128,
  maxLabelChars: 200,
}

export type ValidateFlexCardResult =
  | { ok: true; config: FlexCardConfig }
  | { ok: false; errors: string[] }

/* ─── OmniScript step graph shape ─────────────────────────────────────── */

export const STEP_TYPES = ["input", "api_call", "conditional", "action"] as const
export type StepType = (typeof STEP_TYPES)[number]

export interface ScriptStepBase {
  id: string
  type: StepType
  /** Optional display label for admin UI. */
  label?: string
  /** Default next step — used by `input`, `api_call`, `action`. Not used by `conditional` (which has branches). */
  nextStepId?: string
}

export interface InputStepConfig {
  /** Field path to write the input value to in session state. */
  storeAs: string
  /** Input shape hint. */
  fieldType: FieldValueType
  /** Required flag — runtime enforces (slice 2). */
  required: boolean
  prompt?: string
}

export interface ApiCallStepConfig {
  /** HTTP method — slice-2 runtime executes. */
  method: "GET" | "POST" | "PUT" | "DELETE"
  /** URL template — may reference `${var}` from session state. */
  urlTemplate: string
  /** Optional body template (JSON-shaped). */
  bodyTemplate?: unknown
  /** Store response under this state key. */
  storeAs: string
}

export interface ConditionalBranch {
  /** Var reference in session state. */
  var: string
  /** Equality value (==). */
  equals: string | number | boolean
  /** Where to go if the branch matches. */
  nextStepId: string
}

export interface ConditionalStepConfig {
  branches: readonly ConditionalBranch[]
  /** Fallback when no branch matches. */
  defaultNextStepId: string
}

export interface ActionStepConfig {
  /** Action key — slice-2 runtime resolves to a handler (e.g. "create_deal"). */
  actionKey: string
  /** Args carried into the action call. */
  args?: Readonly<Record<string, unknown>>
}

export interface InputStep extends ScriptStepBase {
  type: "input"
  config: InputStepConfig
}

export interface ApiCallStep extends ScriptStepBase {
  type: "api_call"
  config: ApiCallStepConfig
}

export interface ConditionalStep extends ScriptStepBase {
  type: "conditional"
  config: ConditionalStepConfig
}

export interface ActionStep extends ScriptStepBase {
  type: "action"
  config: ActionStepConfig
}

export type ScriptStep =
  | InputStep
  | ApiCallStep
  | ConditionalStep
  | ActionStep

export interface OmniScriptConfig {
  startStepId: string
  steps: readonly ScriptStep[]
}

/* ─── OmniScript validator I/O ────────────────────────────────────────── */

export interface ValidateOmniScriptInput {
  config: unknown
  limits?: Partial<OmniScriptLimits>
}

export interface OmniScriptLimits {
  maxSteps: number
  maxStepIdChars: number
  maxBranchesPerConditional: number
  maxArgKeys: number
}

export const DEFAULT_OMNI_SCRIPT_LIMITS: Readonly<OmniScriptLimits> = {
  maxSteps: 64,
  maxStepIdChars: 64,
  maxBranchesPerConditional: 16,
  maxArgKeys: 32,
}

export type ValidateOmniScriptResult =
  | { ok: true; config: OmniScriptConfig }
  | { ok: false; errors: string[] }

/* ─── FlexCard renderer I/O ───────────────────────────────────────────── */

export interface RenderFlexCardInput {
  config: FlexCardConfig
  /**
   * Variable / object-field values for conditional evaluation. Caller
   * pre-fetches the record + relevant variables and passes them as a
   * flat map. Helper does NOT walk relationship paths — caller resolves
   * `company.name` → flat key `"company.name"` upstream.
   */
  values: Readonly<Record<string, string | number | boolean | Date | null>>
}

export interface RenderedField {
  path: string
  label: string
  valueType: FieldValueType
  /** Resolved value or null. */
  value: string | number | boolean | Date | null
  /** True if visibleIf condition failed. */
  hidden: boolean
}

export interface RenderedSection {
  id: string
  title: string
  fields: RenderedField[]
  /** True if section-level conditional failed. */
  hidden: boolean
}

export interface RenderedFlexCard {
  sections: RenderedSection[]
}

export type RenderFlexCardResult =
  | { ok: true; rendered: RenderedFlexCard }
  | { ok: false; error: string }
