/**
 * The only way the voice path is allowed to build a Prisma `where`.
 *
 * RLS already isolates the voice tables, so this is the second barrier, not the
 * first. It earns its place because the voice read tools (phase 1b) will also
 * query tables whose queries are assembled from LLM-supplied filters: putting
 * `organizationId` in by construction means a filter can never be the thing
 * that decides which tenant is read, and a test can assert the key's presence
 * on every call without knowing what the filter contained.
 */
export type ScopedWhere<T extends Record<string, unknown>> = T & { organizationId: string }

export function voiceScopedWhere<T extends Record<string, unknown>>(
  organizationId: string,
  extra?: T,
): ScopedWhere<T> {
  if (!organizationId) {
    // An empty org id would produce `organizationId: ""`, which matches nothing
    // and reads as "no data" rather than as the bug it is.
    throw new Error("[voice] voiceScopedWhere called without an organizationId")
  }
  // organizationId is spread LAST so a caller-supplied key cannot override it.
  return { ...(extra ?? ({} as T)), organizationId }
}
