/**
 * C7 personalization-renderer — slice-1 pure helper.
 *
 * Render a template with locked + personalization + contact variables
 * into final subject + body strings. Handles missing placeholders
 * (records but doesn't fail) so slice-2 worker can surface a warning.
 *
 * Pure function: no DB, no clock, no I/O.
 *
 * Precedence (highest wins):
 *   1. lockedVariables (corporate, immutable)
 *   2. contactVariables (per-send contact profile)
 *   3. personalizationValues (rep-filled)
 *
 * NOTE: precedence puts lockedVariables FIRST — corporate content is
 * authoritative. If a rep tries to set a key that collides with a
 * locked key, validator should reject the personalization (see
 * validatePersonalization). This precedence is defense-in-depth.
 */

import type { RenderInput, RenderOutput } from "./types"

const PLACEHOLDER_REGEX = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g

/**
 * Render a template to final content.
 *
 * Empty/null subject → null subject in output. Body always rendered.
 * Placeholders with no resolved value are LEFT IN PLACE (slice-2 worker
 * decides whether to fail the send or surface a warning).
 */
export function renderTemplate(input: RenderInput): RenderOutput {
  const merged = mergeVariables(input)
  const unfilledPlaceholders = new Set<string>()

  const subject =
    input.subjectTemplate === null || input.subjectTemplate === undefined || input.subjectTemplate === ""
      ? null
      : substitute(input.subjectTemplate, merged, unfilledPlaceholders)
  const body = substitute(input.bodyTemplate, merged, unfilledPlaceholders)

  return {
    subject,
    body,
    unfilledPlaceholders: [...unfilledPlaceholders].sort(),
  }
}

/**
 * Compose the merged variable map per the precedence rules. Exported
 * so slice-2 can compute the same merge for preview UI.
 */
export function mergeVariables(
  input: Pick<RenderInput, "lockedVariables" | "personalizationValues" | "contactVariables">,
): Record<string, string> {
  // Highest precedence applied LAST so they overwrite lower precedence.
  const merged: Record<string, string> = {}
  // Lowest precedence first: rep-filled.
  for (const [key, value] of Object.entries(input.personalizationValues)) {
    merged[key] = stringify(value)
  }
  // Mid: contact profile.
  if (input.contactVariables) {
    for (const [key, value] of Object.entries(input.contactVariables)) {
      merged[key] = stringify(value)
    }
  }
  // Highest: corporate locked.
  for (const [key, value] of Object.entries(input.lockedVariables)) {
    merged[key] = stringify(value)
  }
  return merged
}

/**
 * Replace {{placeholder}} occurrences in `template`. Unresolved
 * placeholders are recorded in `unfilledOut` set and left as-is in
 * the output (caller decides whether to fail).
 */
function substitute(
  template: string,
  values: Record<string, string>,
  unfilledOut: Set<string>,
): string {
  PLACEHOLDER_REGEX.lastIndex = 0
  return template.replace(PLACEHOLDER_REGEX, (match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(values, name)) {
      return values[name]
    }
    unfilledOut.add(name)
    return match
  })
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  // Objects/arrays serialized as JSON for the placeholder slot.
  try {
    return JSON.stringify(value)
  } catch {
    return ""
  }
}

/**
 * Pure helper for slice-2: count placeholders in a template (excluding
 * dedup). Useful for "this template has N variables" UI display.
 */
export function countPlaceholders(template: string): number {
  PLACEHOLDER_REGEX.lastIndex = 0
  let count = 0
  while (PLACEHOLDER_REGEX.exec(template) !== null) count += 1
  return count
}
