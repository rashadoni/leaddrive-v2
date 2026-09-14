/**
 * Which localized explanation a failed MTM read deserves.
 *
 * After the field-scope audit (#204) a web user without an employee card got
 * a 403 whose English server sentence — "This view needs a field scope: link
 * your user to an active MTM employee card" — was pasted into a red toast on
 * an Azerbaijani screen, and the page stayed empty. The server's `code` is the
 * contract; the words belong to the page, in the reader's language.
 *
 * The page renders `accessError.<key>` from its own namespace and never shows
 * the server's `error` string.
 */
export type MtmAccessErrorKey = "scopeRequired" | "agentOutOfScope" | "forbidden" | "loadFailed"

export function mtmAccessErrorKey(status: number, body: unknown): MtmAccessErrorKey {
  const code = body && typeof body === "object" && !Array.isArray(body)
    ? (body as { code?: unknown }).code
    : undefined
  if (code === "MTM_FIELD_SCOPE_REQUIRED") return "scopeRequired"
  if (code === "MTM_AGENT_OUT_OF_SCOPE") return "agentOutOfScope"
  if (status === 401 || status === 403) return "forbidden"
  return "loadFailed"
}
