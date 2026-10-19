/**
 * Undoing a Page binding at Meta (src/lib/social/meta-unbind.ts): what each
 * call sends, and how Meta's answers are sorted.
 *
 * The token is the prospect's access to his own Page. It must leave only as a
 * Bearer header — never in a URL, where proxies and logs keep it — and Meta's
 * own text must never come back out, since it can carry names and ids.
 */
import { describe, expect, it, vi } from "vitest"
import {
  MAX_PAGE_LIST_REQUESTS,
  classifyGraphFailure,
  listAccessiblePageIds,
  revokeUserGrant,
  unsubscribePageFromApp,
} from "@/lib/social/meta-unbind"

const TOKEN = "EAAG-secret-token-value"

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function recorder(responses: Array<Response | Error>) {
  const calls: Array<{ url: string; method: string; authorization: string | null; body: unknown; hasSignal: boolean }> = []
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      authorization: headers.get("authorization"),
      body: init?.body ?? null,
      hasSignal: !!init?.signal,
    })
    const next = responses.shift()
    if (!next) throw new Error("unexpected request")
    if (next instanceof Error) throw next
    return next
  })
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls }
}

function expectTokenOnlyInHeader(calls: Array<{ url: string; authorization: string | null; body: unknown; hasSignal: boolean }>) {
  for (const call of calls) {
    expect(call.authorization).toBe(`Bearer ${TOKEN}`)
    expect(call.url).not.toContain(TOKEN)
    expect(call.url).not.toContain("access_token")
    expect(call.body).toBeNull()
    expect(call.hasSignal).toBe(true)
  }
}

describe("the Graph calls", () => {
  it("unsubscribes a Page with DELETE /{page}/subscribed_apps and the Page token as a Bearer header", async () => {
    const { fetch, calls } = recorder([jsonResponse(200, { success: true })])
    await expect(unsubscribePageFromApp("1234567890", TOKEN, { fetch })).resolves.toEqual({ verdict: "removed", code: null })
    expect(calls).toHaveLength(1)
    const url = new URL(calls[0].url)
    expect([calls[0].method, url.host, url.pathname, url.search]).toEqual(["DELETE", "graph.facebook.com", "/v21.0/1234567890/subscribed_apps", ""])
    expectTokenOnlyInHeader(calls)
  })

  it("never puts something that is not a Page id into the path", async () => {
    const { fetch, calls } = recorder([])
    await expect(unsubscribePageFromApp("../me/permissions", TOKEN, { fetch })).resolves.toEqual({ verdict: "gone", code: "meta_bad_page_id" })
    expect(calls).toHaveLength(0)
  })

  it("revokes the grant with DELETE /me/permissions and the user token as a Bearer header", async () => {
    const { fetch, calls } = recorder([jsonResponse(200, { success: true })])
    await expect(revokeUserGrant(TOKEN, { fetch })).resolves.toEqual({ verdict: "removed", code: null })
    const url = new URL(calls[0].url)
    expect([calls[0].method, url.pathname, url.search]).toEqual(["DELETE", "/v21.0/me/permissions", ""])
    expectTokenOnlyInHeader(calls)
  })

  it("lists the Pages by its own cursor, never by Meta's `next` link, which carries the token", async () => {
    const { fetch, calls } = recorder([
      jsonResponse(200, {
        data: [{ id: "111" }, { id: "222" }],
        paging: { cursors: { before: "b1", after: "c1" }, next: `https://graph.facebook.com/v21.0/me/accounts?access_token=${TOKEN}&after=c1` },
      }),
      jsonResponse(200, { data: [{ id: "333" }, { id: "111" }], paging: { cursors: { before: "b2", after: "c2" } } }),
    ])
    await expect(listAccessiblePageIds(TOKEN, { fetch })).resolves.toEqual({ ok: true, pageIds: ["111", "222", "333"], complete: true })
    expect(calls.map((call) => [call.method, new URL(call.url).pathname])).toEqual([
      ["GET", "/v21.0/me/accounts"],
      ["GET", "/v21.0/me/accounts"],
    ])
    expect(new URL(calls[0].url).searchParams.get("fields")).toBe("id")
    expect(new URL(calls[0].url).searchParams.get("after")).toBeNull()
    expect(new URL(calls[1].url).searchParams.get("after")).toBe("c1")
    expectTokenOnlyInHeader(calls)
  })

  it("stops after five result pages and says the listing is incomplete", async () => {
    const page = (n: number) =>
      jsonResponse(200, { data: [{ id: String(1000 + n) }], paging: { cursors: { after: `c${n}` }, next: "https://graph.facebook.com/next" } })
    const { fetch, calls } = recorder(Array.from({ length: MAX_PAGE_LIST_REQUESTS + 1 }, (_, n) => page(n)))
    const listing = await listAccessiblePageIds(TOKEN, { fetch })
    expect(listing).toMatchObject({ ok: true, complete: false })
    expect(calls).toHaveLength(MAX_PAGE_LIST_REQUESTS)
  })

  it("calls a listing with an id that is not a Page id incomplete, so nothing is decided on it", async () => {
    const { fetch } = recorder([jsonResponse(200, { data: [{ id: "111" }, { id: "x'1" }, { name: "no id" }] })])
    await expect(listAccessiblePageIds(TOKEN, { fetch })).resolves.toEqual({ ok: true, pageIds: ["111"], complete: false })
  })

  it("reports a failed listing with its verdict and code", async () => {
    const { fetch } = recorder([jsonResponse(400, { error: { code: 190, error_subcode: 460, message: "Nigar Əliyeva changed her password" } })])
    await expect(listAccessiblePageIds(TOKEN, { fetch })).resolves.toEqual({ ok: false, verdict: "token_invalid", code: "meta_190_460" })
  })

  it("turns a timeout and a lost connection into retries with our own code", async () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })
    const { fetch } = recorder([timeout, new TypeError("fetch failed")])
    await expect(unsubscribePageFromApp("1234567890", TOKEN, { fetch })).resolves.toEqual({ verdict: "retry", code: "net_timeout" })
    await expect(revokeUserGrant(TOKEN, { fetch })).resolves.toEqual({ verdict: "retry", code: "net_error" })
  })
})

describe("sorting Meta's answers", () => {
  const error = (code: number, subcode?: number) => ({
    error: { code, ...(subcode === undefined ? {} : { error_subcode: subcode }), message: "Page «Xəzər Logistika» (id 1234567890) for Nigar", type: "OAuthException" },
  })

  it.each([
    ["success", 200, { success: true }, "removed", null],
    ["success without a body", 200, null, "removed", null],
    ["success: false", 200, { success: false }, "retry", "meta_success_false"],
    ["dead token", 400, error(190), "token_invalid", "meta_190"],
    ["app removed by the person", 400, error(190, 458), "token_invalid", "meta_190_458"],
    ["session key invalid", 400, error(102), "token_invalid", "meta_102"],
    ["object gone or unreachable", 400, error(100, 33), "gone", "meta_100_33"],
    ["permission missing", 403, error(10), "refused", "meta_10"],
    ["permissions error", 403, error(200), "refused", "meta_200"],
    ["capability missing", 400, error(3), "refused", "meta_3"],
    ["rate limit", 400, error(4), "retry", "meta_4"],
    ["page rate limit", 400, error(32), "retry", "meta_32"],
    ["other invalid parameter", 400, error(100), "retry", "meta_100"],
    ["server error without a body", 500, null, "retry", "http_500"],
    ["bad gateway with HTML", 502, "<html>", "retry", "http_502"],
    ["too many requests", 429, {}, "retry", "http_429"],
    ["a code that is not a number", 400, { error: { code: "190; drop" } }, "retry", "http_400"],
  ])("%s → %s", (_label, status, body, verdict, code) => {
    expect(classifyGraphFailure(status, body)).toEqual({ verdict, code })
  })

  it("never returns Meta's text, only codes the database accepts", () => {
    for (const [status, body] of [[400, error(190, 460)], [403, error(10)], [400, error(100, 33)], [500, error(1)], [503, null]] as const) {
      const { code } = classifyGraphFailure(status, body)
      expect(code).toMatch(/^(http|meta|net)_[0-9a-z_]{1,32}$/)
      expect(code).not.toMatch(/Nigar|Xəzər|1234567890|OAuth/)
    }
  })
})
