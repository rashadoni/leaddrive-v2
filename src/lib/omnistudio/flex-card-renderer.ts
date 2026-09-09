/**
 * FlexCard renderer — N16 Phase 6 Block D slice 2.
 *
 * Given a validated FlexCardConfig + a flat values map, produce a
 * render-ready section tree where conditional sections/fields are
 * marked `hidden: true` and their values stripped.
 *
 * Slice-2 UI layer consumes the rendered tree to draw the FlexCard.
 *
 * Pure synchronous. Caller is responsible for:
 *   • Pre-fetching the underlying record + relationship paths.
 *   • Flattening to a `Record<string, ...>` map keyed by dotted path
 *     (e.g. `{ name: "...", "company.name": "...", totalSpent: 1234 }`).
 *
 * Helper does NOT walk Prisma relations — that's slice-2 caller code.
 *
 * Defense-in-depth: `Object.prototype.hasOwnProperty.call` on every
 * values lookup. Prototype-chain reads return null (not the inherited
 * value).
 */
import type {
  FlexCardConditional,
  FlexCardField,
  FlexCardSection,
  RenderFlexCardInput,
  RenderFlexCardResult,
  RenderedField,
  RenderedSection,
} from "./types"

function getValue(
  values: RenderFlexCardInput["values"],
  key: string
): string | number | boolean | Date | null {
  if (!Object.prototype.hasOwnProperty.call(values, key)) return null
  const v = values[key]
  return v ?? null
}

function evaluateConditional(
  cond: FlexCardConditional | undefined,
  values: RenderFlexCardInput["values"]
): boolean {
  if (!cond) return true // render
  const v = getValue(values, cond.var)
  if (v === null) return false // missing var → conditional fails
  const lhs = v instanceof Date ? v.getTime() : v
  return lhs === cond.equals
}

function renderField(
  f: FlexCardField,
  values: RenderFlexCardInput["values"]
): RenderedField {
  const shouldShow = evaluateConditional(f.visibleIf, values)
  const value = shouldShow ? getValue(values, f.path) : null
  return {
    path: f.path,
    label: f.label,
    valueType: f.valueType,
    value,
    hidden: !shouldShow,
  }
}

function renderSection(
  s: FlexCardSection,
  values: RenderFlexCardInput["values"]
): RenderedSection {
  const shouldShow = evaluateConditional(s.conditional, values)
  // Fields are always traversed for consistency in output shape, but
  // when the section is hidden, all field values come back null +
  // hidden=true via the section-conditional fallback.
  const fields: RenderedField[] = s.fields.map((f) => {
    if (!shouldShow) {
      return {
        path: f.path,
        label: f.label,
        valueType: f.valueType,
        value: null,
        hidden: true,
      }
    }
    return renderField(f, values)
  })
  return {
    id: s.id,
    title: s.title,
    fields,
    hidden: !shouldShow,
  }
}

export function renderFlexCard(input: RenderFlexCardInput): RenderFlexCardResult {
  if (!input.config || typeof input.config !== "object") {
    return { ok: false, error: "config must be an object" }
  }
  if (!Array.isArray(input.config.sections)) {
    return { ok: false, error: "config.sections must be an array" }
  }
  if (!input.values || typeof input.values !== "object") {
    return { ok: false, error: "values must be an object" }
  }

  const sections: RenderedSection[] = input.config.sections.map((s) =>
    renderSection(s, input.values)
  )

  return { ok: true, rendered: { sections } }
}
