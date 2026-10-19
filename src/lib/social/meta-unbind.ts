/**
 * Undoing a Facebook Page binding at Meta: stop the Page's webhook delivery to
 * our app.
 *
 * The demo's Page connection (src/lib/demo-center/demo-social-release.ts) is
 * the first caller. The product's own Disconnect
 * (src/app/api/v1/channels/[id]/route.ts) has the same gap — it clears our rows
 * and never tells Meta — and could reuse this later.
 *
 * Deliberately absent: taking back the person's whole grant
 * (`DELETE /me/permissions`). Whether a grant reaches a Page some organisation
 * relies on cannot be proven from `/me/accounts`, which does not list Pages
 * reached through a business portfolio (meta-granted-assets.ts), and one grant
 * covers every Page the person granted. The authorization stays with the
 * person, who can remove LeadDrive in Meta's Business Integrations.
 *
 * Every call:
 *   - sends its token as a Bearer header — never in a URL, a body or a log;
 *   - gives up after 10 seconds;
 *   - answers with a verdict and a short code of ours (`http_500`, `meta_190`,
 *     `net_timeout`), never Meta's text, which can carry names and ids.
 */

const TIMEOUT_MS = 10_000
const META_ID = /^[0-9]{1,32}$/

/**
 * What a Graph call came to.
 *   - `removed`: it did what was asked.
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

async function graphDelete(deps: GraphDeps, path: string, token: string): Promise<GraphResponse> {
  const url = new URL(`${graphBase()}${path}`)
  const doFetch = deps.fetch ?? fetch
  try {
    const response = await doFetch(url.toString(), {
      method: "DELETE",
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
  return outcomeOf(await graphDelete(deps, `/${pageId}/subscribed_apps`, pageToken))
}
