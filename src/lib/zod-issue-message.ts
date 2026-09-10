type ZodIssueLike = {
  readonly path: ReadonlyArray<PropertyKey>
  readonly message: string
}

/**
 * The first issue of a failed parse, rendered as `field: reason`.
 *
 * The field prefix is what keeps an API error actionable when the reason is
 * not. zod's own text collapses to a bare "Invalid input" whenever no locale is
 * registered — which is exactly what a tree-shaken production bundle used to
 * do (see the zod rule in `next.config.ts`), and "Invalid input" tells the
 * caller nothing about which of forty submitted fields to fix. The path comes
 * from the schema rather than from the locale, so it stays useful either way.
 */
export function firstIssueMessage(error: { readonly issues: ReadonlyArray<ZodIssueLike> }): string {
  const issue = error.issues[0]
  if (!issue) return "Invalid input"
  const field = issue.path.map((segment) => String(segment)).join(".")
  return field ? `${field}: ${issue.message}` : issue.message
}
