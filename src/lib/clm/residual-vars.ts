/**
 * Contract Editor — Slice 1, Step 5. Residual merge-variable scanner.
 *
 * After a user freely edits the TipTap body, it is plain HTML/text divorced
 * from any template's clause set — so `clause-substituter.ts`'s
 * `substituteClauses` (which consumes a {clauses,variables,values} template
 * input) does NOT apply. To gate "Send for approval" on leftover `{{var}}`
 * tokens we need a lightweight text scanner. This is intentionally NOT the
 * substituter; it shares only the token grammar.
 *
 * Token grammar mirrors the substituter's `VAR_REF_RE`
 * (`clause-substituter.ts:68`): `{{ name }}`, name = `[A-Za-z_][A-Za-z0-9_]*`,
 * surrounding whitespace tolerated. Unlike the substituter (which SKIPS
 * prototype-chain names to avoid pollution), the scanner REPORTS a stray
 * `{{__proto__}}` — it's a malformed token the author must remove before send.
 */

const VAR_REF_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g

/**
 * Distinct unresolved `{{var}}` token names in `text`, in first-seen order.
 * An empty array means the body is fully resolved (safe to send).
 */
export function findResidualVars(text: string | null | undefined): string[] {
  const src = text ?? ""
  const seen = new Set<string>()
  const out: string[] = []
  let m: RegExpExecArray | null
  VAR_REF_RE.lastIndex = 0 // stateful global regex — reset for deterministic reuse
  while ((m = VAR_REF_RE.exec(src)) !== null) {
    const name = m[1]
    if (!seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }
  return out
}

/** True iff the text still contains at least one unresolved `{{var}}` token. */
export function hasUnresolvedVars(text: string | null | undefined): boolean {
  return findResidualVars(text).length > 0
}
