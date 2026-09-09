/**
 * Template clause substituter — M5 Phase 6 Block C slice 1.
 *
 * Given a template (clauses + variables spec) and caller-supplied
 * values, returns the rendered clause set + concatenated body. Used
 * by:
 *   • Slice-2 contract-create UI ("instantiate from template").
 *   • Slice-2 PDF rendering (the rendered body lands in Contract.renderedBody).
 *   • E-Sign (slice-3 M6) — sends the rendered body to DocuSign.
 *
 * Pure synchronous. Defensive:
 *   • Detects missing required variables.
 *   • Detects unknown `{{varName}}` references in clause bodies.
 *   • Detects type mismatches (e.g. spec says `number`, caller sent `string`).
 *   • Conditional-render gate: clauses with `conditional` are emitted
 *     as `skipped: true` (kept in output for caller bookkeeping) and
 *     their body is excluded from the concatenated `renderedBody`.
 */
import {
  VARIABLE_TYPES,
  type SubstituteInput,
  type SubstituteResult,
  type TemplateClause,
  type TemplateVariable,
  type VariableType,
} from "./types"

/* ─── Variable type coercion ──────────────────────────────────────────── */

function detectActualType(v: unknown): string {
  if (v === null || v === undefined) return "null"
  if (v instanceof Date) return "date"
  if (Array.isArray(v)) return "array"
  return typeof v
}

function matchesType(v: unknown, t: VariableType): boolean {
  switch (t) {
    case "string":
      return typeof v === "string"
    case "number":
      return typeof v === "number" && Number.isFinite(v)
    case "boolean":
      return typeof v === "boolean"
    case "date":
      // Accept Date instance OR ISO-ish string (post-JSON deserialisation).
      if (v instanceof Date) return Number.isFinite(v.getTime())
      if (typeof v === "string") return Number.isFinite(new Date(v).getTime())
      return false
  }
}

/**
 * Render a single value into its substitution string. Dates render
 * as ISO-8601 (caller can post-format if they want locale-aware text;
 * pure helper stays locale-neutral).
 */
function renderValue(v: string | number | boolean | Date): string {
  if (v instanceof Date) return v.toISOString()
  return String(v)
}

/* ─── Variable reference extraction ───────────────────────────────────── */

// `{{varName}}` — alphanumeric + underscore, 1+ chars. Whitespace
// around the name is tolerated. Anchored so embedded `{{...}}` inside
// `{{...}}` is caught as malformed via the unknownVars pass.
const VAR_REF_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g

function extractRefs(body: string): string[] {
  const refs: string[] = []
  let m: RegExpExecArray | null
  // Reset lastIndex so repeated extracts on the same regex stay deterministic.
  VAR_REF_RE.lastIndex = 0
  while ((m = VAR_REF_RE.exec(body)) !== null) {
    refs.push(m[1])
  }
  return refs
}

function substituteRefs(
  body: string,
  values: Readonly<Record<string, string | number | boolean | Date>>
): string {
  VAR_REF_RE.lastIndex = 0
  return body.replace(VAR_REF_RE, (_, name: string) => {
    const v = values[name]
    if (v === undefined || v === null) return ""
    return renderValue(v)
  })
}

/* ─── Spec validation ─────────────────────────────────────────────────── */

function validateSpec(
  variables: readonly TemplateVariable[]
): { ok: true } | { ok: false; error: string } {
  const seen = new Set<string>()
  for (const v of variables) {
    if (!v.name || typeof v.name !== "string") {
      return { ok: false, error: `variable spec: missing/invalid name` }
    }
    if (seen.has(v.name)) {
      return { ok: false, error: `variable spec: duplicate name "${v.name}"` }
    }
    seen.add(v.name)
    if (!(VARIABLE_TYPES as readonly string[]).includes(v.type)) {
      return { ok: false, error: `variable "${v.name}" has unknown type "${String(v.type)}"` }
    }
    if (typeof v.required !== "boolean") {
      return { ok: false, error: `variable "${v.name}": required must be boolean` }
    }
  }
  return { ok: true }
}

/* ─── Conditional gate ────────────────────────────────────────────────── */

function evaluateConditional(
  clause: TemplateClause,
  values: Readonly<Record<string, string | number | boolean | Date>>
): boolean {
  if (!clause.conditional) return true // render
  const v = values[clause.conditional.var]
  // Missing/null variable means the conditional fails — don't render.
  if (v === undefined || v === null) return false
  // === comparison post-coercion. Dates collapse to ms; the typed
  // `equals` is string | number | boolean only (Date conditionals are
  // not supported — slice-2 may extend if a real use-case appears).
  const lhs = v instanceof Date ? v.getTime() : v
  return lhs === clause.conditional.equals
}

/* ─── Main entry ──────────────────────────────────────────────────────── */

// Reject any variable name that maps to a JS prototype-chain key.
// Templates are admin-authored but the JSONB column accepts arbitrary
// data; defense-in-depth.
const FORBIDDEN_VAR_NAMES = new Set(["__proto__", "constructor", "prototype"])

export function substituteClauses(input: SubstituteInput): SubstituteResult {
  const { clauses, variables, values } = input

  // 0. Spec sanity.
  const specCheck = validateSpec(variables)
  if (!specCheck.ok) {
    // Treat spec errors as fatal — surface via typeMismatches __spec__
    // row (caller surfaces this to admin editing the template).
    return {
      ok: false,
      missingVars: [],
      unknownVars: [],
      typeMismatches: [
        { name: "__spec__", expected: "string", got: specCheck.error },
      ],
    }
  }

  // Forbidden-name guard. Done after generic spec validation so we
  // surface the spec error first if both fire.
  for (const v of variables) {
    if (FORBIDDEN_VAR_NAMES.has(v.name)) {
      return {
        ok: false,
        missingVars: [],
        unknownVars: [],
        typeMismatches: [
          {
            name: "__spec__",
            expected: "string",
            got: `variable name "${v.name}" is reserved (JS prototype chain)`,
          },
        ],
      }
    }
  }

  // Null-prototype dicts — blocks `effective.__proto__` / `.constructor`
  // / `.toString` reads from leaking native prototype values.
  const specByName: Record<string, TemplateVariable> = Object.create(null)
  for (const v of variables) specByName[v.name] = v

  // 1. Build effective values: caller-supplied values UNION declared defaults
  //    for vars that aren't provided. Required-but-missing surfaces below.
  const effective: Record<string, string | number | boolean | Date> = Object.create(null)
  for (const v of variables) {
    if (Object.prototype.hasOwnProperty.call(values, v.name)) {
      effective[v.name] = values[v.name]
    } else if (v.default !== undefined) {
      effective[v.name] = v.default
    }
  }
  // Allow caller to pass extras (e.g. `today` injected by the substituter
  // entrypoint). Spec-undeclared keys are tolerated here but flagged as
  // `unknownVars` ONLY if a clause body or conditional actually
  // references them — see step 4.
  for (const k of Object.keys(values)) {
    if (FORBIDDEN_VAR_NAMES.has(k)) continue // skip prototype-chain keys
    if (!Object.prototype.hasOwnProperty.call(effective, k)) {
      effective[k] = values[k]
    }
  }

  // 2. Required-presence check.
  const missingVars: string[] = []
  for (const v of variables) {
    if (
      v.required &&
      (effective[v.name] === undefined ||
        effective[v.name] === null ||
        (typeof effective[v.name] === "string" && (effective[v.name] as string).length === 0))
    ) {
      missingVars.push(v.name)
    }
  }

  // 3. Type-match check on values we have.
  const typeMismatches: { name: string; expected: VariableType; got: string }[] = []
  for (const v of variables) {
    const val = effective[v.name]
    if (val === undefined || val === null) continue
    if (!matchesType(val, v.type)) {
      typeMismatches.push({
        name: v.name,
        expected: v.type,
        got: detectActualType(val),
      })
    }
  }

  // 4. Clause reference check — every `{{var}}` AND every conditional
  //    `var` must exist in the spec. Architect-flagged: the conditional
  //    path was previously unprotected against undeclared references,
  //    which combined with the now-removed plain-object dicts could
  //    have surfaced prototype-chain reads in the conditional gate.
  const unknownVars = new Set<string>()
  for (const c of clauses) {
    for (const ref of extractRefs(c.body)) {
      if (!Object.prototype.hasOwnProperty.call(specByName, ref)) {
        unknownVars.add(ref)
      }
    }
    if (c.conditional) {
      const condVar = c.conditional.var
      if (!Object.prototype.hasOwnProperty.call(specByName, condVar)) {
        unknownVars.add(condVar)
      }
    }
  }

  if (missingVars.length > 0 || typeMismatches.length > 0 || unknownVars.size > 0) {
    return {
      ok: false,
      missingVars,
      unknownVars: Array.from(unknownVars),
      typeMismatches,
    }
  }

  // 5. Render. For each clause: evaluate conditional gate, then
  //    substitute references in the body.
  const renderedClauses = clauses.map((c) => {
    const shouldRender = evaluateConditional(c, effective)
    return {
      id: c.id,
      title: c.title,
      body: shouldRender ? substituteRefs(c.body, effective) : "",
      skipped: !shouldRender,
    }
  })

  const renderedBody = renderedClauses
    .filter((c) => !c.skipped)
    .map((c) => `${c.title}\n\n${c.body}`.trim())
    .join("\n\n")

  return {
    ok: true,
    clauses: renderedClauses,
    renderedBody,
  }
}
