/**
 * Undoing a Facebook Page binding at Meta: stop the Page's webhook delivery to
 * our app, and take back the permissions the person granted.
 *
 * The demo's Page connection (src/lib/demo-center/demo-social-release.ts) is
 * the first caller. The product's own Disconnect
 * (src/app/api/v1/channels/[id]/route.ts) has the same gap — it clears our rows
 * and never tells Meta — and could reuse these later.
 *
 * Every call:
 *   - sends its token as a Bearer header — never in a URL, a body or a log;
 *   - gives up after 10 seconds;
 *   - answers with a verdict and a short code of ours (`http_500`, `meta_190`,
 *     `net_timeout`), never Meta's text, which can carry names and ids.
 *
 * Meta's `paging.next` links carry the access token in their query string, so
 * the Page listing never follows them: it rebuilds its own request from the
 * opaque `after` cursor.
 */

const TIMEOUT_MS = 10_000
/** At most this many result pages of `/me/accounts`; past it, the listing is reported incomplete. */
export const MAX_PAGE_LIST_REQUESTS = 5
const PAGE_LIST_LIMIT = "100"
const META_ID = /^[0-9]{1,32}$/

/**
 * What a Graph call came to.
 *   - `removed`: it did what was asked (for a read: it answered).
 *   - `gone`: the object is not there any more (Meta's #100 / subcode 33).
 *   - `token_invalid`: the token is dead (#190, #102) — the app was removed, the password changed.
 *   - `refused`: the token lacks the permission (#10, #3, #200–#299).
 *   - `retry`: anything else — a 5xx, a rate limit, a timeout, an answer we cannot read.
 */
export type GraphVerdict = "removed" | "gone" | "token_invalid" | "refused" | "retry"

export interface GraphOutcome {
  verdict: GraphVerdict
  /** Null when the call succeeded. Always matches /^(http|meta|net)_[0-9a-z_]{1,32}$/. */
  code: string | null
}

export type PageListing =
  | { ok: true; pageIds: string[]; complete: boolean }
  | { ok: false; verdict: Exclude<GraphVerdict, "removed">; code: string }

type Fetch = typeof fetch
export interface GraphDeps {
  fetch?: Fetch
}

function graphBase(): string {
  return (process.env.META_GRAPH_BASE || "https://graph.facebook.com/v21.0").replace(/\/+$/, "")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function metaNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 1_000_000_000 ? value : null
}

function httpCode(status: number): string {
  return Number.isInteger(status) && status >= 100 && status <= 999 ? `http_${status}` : "http_unknown"
}

/**
 * Sort a Graph answer into a verdict. Only Meta's numeric code and subcode are
 * read; its message never leaves this function.
 */
export function classifyGraphFailure(status: number, body: unknown): GraphOutcome {
  const error = isRecord(body) && isRecord(body.error) ? body.error : null
  if (!error && status >= 200 && status < 300) {
    if (isRecord(body) && body.success === false) return { verdict: "retry", code: "meta_success_false" }
    return { verdict: "removed", code: null }
  }
  const code = metaNumber(error?.code)
  if (code === null) return { verdict: "retry", code: httpCode(status) }
  const subcode = metaNumber(error?.error_subcode)
  const short = subcode === null ? `meta_${code}` : `meta_${code}_${subcode}`
  if (code === 190 || code === 102) return { verdict: "token_invalid", code: short }
  // «Object with ID … does not exist, cannot be loaded due to missing
  // permissions, or does not support this operation.»
  if (code === 100 && subcode === 33) return { verdict: "gone", code: short }
  if (code === 10 || code === 3 || (code >= 200 && code <= 299)) return { verdict: "refused", code: short }
  return { verdict: "retry", code: short }
}

type GraphResponse = { status: number; body: unknown } | { network: "timeout" | "error" }

async function graphRequest(
  deps: GraphDeps,
  method: "GET" | "DELETE",
  path: string,
  token: string,
  query: Record<string, string> = {},
): Promise<GraphResponse> {
  const url = new URL(`${graphBase()}${path}`)
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value)
  const doFetch = deps.fetch ?? fetch
  try {
    const response = await doFetch(url.toString(), {
      method,
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = await response.json().catch(() => null)
    return { status: response.status, body }
  } catch (error) {
    const name = error instanceof Error ? error.name : ""
    return { network: name === "TimeoutError" || name === "AbortError" ? "timeout" : "error" }
  }
}

function outcomeOf(response: GraphResponse): GraphOutcome {
  if ("network" in response) return { verdict: "retry", code: `net_${response.network}` }
  return classifyGraphFailure(response.status, response.body)
}

/** `DELETE /{pageId}/subscribed_apps` with the Page token: Meta stops sending this Page's events to our app. */
export async function unsubscribePageFromApp(pageId: string, pageToken: string, deps: GraphDeps = {}): Promise<GraphOutcome> {
  if (!META_ID.test(pageId)) return { verdict: "gone", code: "meta_bad_page_id" }
  return outcomeOf(await graphRequest(deps, "DELETE", `/${pageId}/subscribed_apps`, pageToken))
}

/** `DELETE /me/permissions` with the user token: every permission the person gave our app is taken back. */
export async function revokeUserGrant(userToken: string, deps: GraphDeps = {}): Promise<GraphOutcome> {
  return outcomeOf(await graphRequest(deps, "DELETE", "/me/permissions", userToken))
}

/**
 * Every Page the user token can reach (`GET /me/accounts?fields=id`), through
 * at most MAX_PAGE_LIST_REQUESTS result pages. `complete: false` when there were
 * more, or when Meta sent an id that is not a Page id: the caller then cannot
 * know that none of them is shared, and must not act as if it did.
 */
export async function listAccessiblePageIds(userToken: string, deps: GraphDeps = {}): Promise<PageListing> {
  const ids = new Set<string>()
  let after: string | null = null
  for (let request = 0; request < MAX_PAGE_LIST_REQUESTS; request += 1) {
    const response = await graphRequest(deps, "GET", "/me/accounts", userToken, {
      fields: "id",
      limit: PAGE_LIST_LIMIT,
      ...(after ? { after } : {}),
    })
    const outcome = outcomeOf(response)
    if (outcome.verdict !== "removed") {
      return { ok: false, verdict: outcome.verdict, code: outcome.code ?? "meta_unknown" }
    }
    const body = "body" in response ? response.body : null
    const data = isRecord(body) ? body.data : null
    if (!Array.isArray(data)) return { ok: false, verdict: "retry", code: "meta_bad_listing" }
    let unreadable = false
    for (const item of data) {
      const id = isRecord(item) ? item.id : null
      if (typeof id === "string" && META_ID.test(id)) ids.add(id)
      else unreadable = true
    }
    if (unreadable) return { ok: true, pageIds: [...ids], complete: false }
    const paging = isRecord(body) && isRecord(body.paging) ? body.paging : null
    const cursors = paging && isRecord(paging.cursors) ? paging.cursors : null
    const nextCursor = typeof cursors?.after === "string" && cursors.after ? cursors.after : null
    if (typeof paging?.next !== "string" || !nextCursor) return { ok: true, pageIds: [...ids], complete: true }
    after = nextCursor
  }
  return { ok: true, pageIds: [...ids], complete: false }
}
