import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { grantedPageIds, fetchGrantedPage, enumerateGrantedPages } from "@/lib/social/meta-granted-assets"

/**
 * Facebook Login for Business asset enumeration.
 *
 * `GET /me/accounts` lists Pages by the user's own Page roles. The business-login flow does not work
 * that way: the person selects assets in Meta's selector and the grant is recorded against those
 * assets, so someone who reaches a Page only through a business portfolio finishes a fully-consented
 * login with an EMPTY list — which the callback used to report as `no_admined_pages`, i.e. as though
 * they administered nothing.
 *
 * Reproduced in the browser on 2026-09-20 with app 2414060595720618: Page "Lead Drive CRM"
 * (373662722735767) and business "Lead Drive" (1170592885027596) were both selected and confirmed by
 * Meta, and the callback still failed. These tests fix the shape of the documented fallback —
 * debug_token's `granular_scopes[].target_ids`.
 */

const GRAPH = "https://graph.facebook.com/v21.0"
const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

function jsonOnce(body: unknown, ok = true, status = 200) {
  fetchMock.mockResolvedValueOnce({
    ok,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  })
}

describe("grantedPageIds", () => {
  it("reads Page ids out of granular_scopes", async () => {
    jsonOnce({
      data: {
        is_valid: true,
        scopes: ["public_profile", "pages_messaging", "business_management"],
        granular_scopes: [
          { scope: "pages_messaging", target_ids: ["373662722735767"] },
          { scope: "pages_show_list", target_ids: ["373662722735767"] },
        ],
      },
    })
    const r = await grantedPageIds(GRAPH, "APP", "SECRET", "USERTOKEN")
    expect(r.pageIds).toEqual(["373662722735767"])
    expect(r.grantedScopes).toContain("pages_messaging")
  })

  it("does NOT treat a business id as a Page id", async () => {
    // business_management's target_ids are BUSINESS ids. Fetching one as a Page would chase an object
    // that is not a Page and report a misleading failure — this is the exact id pair from the live
    // test, so the business must be ignored and only the Page kept.
    jsonOnce({
      data: {
        granular_scopes: [
          { scope: "business_management", target_ids: ["1170592885027596"] },
          { scope: "pages_messaging", target_ids: ["373662722735767"] },
        ],
      },
    })
    const r = await grantedPageIds(GRAPH, "APP", "SECRET", "USERTOKEN")
    expect(r.pageIds).toEqual(["373662722735767"])
    expect(r.pageIds).not.toContain("1170592885027596")
  })

  it("de-duplicates a Page granted through several permissions", async () => {
    jsonOnce({
      data: {
        granular_scopes: [
          { scope: "pages_messaging", target_ids: ["P1", "P2"] },
          { scope: "pages_manage_metadata", target_ids: ["P1"] },
        ],
      },
    })
    expect((await grantedPageIds(GRAPH, "APP", "SECRET", "T")).pageIds.sort()).toEqual(["P1", "P2"])
  })

  it("sends the app access token and the token under inspection, and never logs them", async () => {
    jsonOnce({ data: { granular_scopes: [] } })
    await grantedPageIds(GRAPH, "APP", "SECRET", "USERTOKEN")
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain("/debug_token")
    expect(url).toContain("input_token=USERTOKEN")
    expect(url).toContain(encodeURIComponent("APP|SECRET"))
  })

  it("returns a redacted error rather than the provider body on failure", async () => {
    jsonOnce({ error: { message: "Invalid OAuth access token", access_token: "LEAKED_TOKEN" } }, false, 400)
    const r = await grantedPageIds(GRAPH, "APP", "SECRET", "T")
    expect(r.pageIds).toEqual([])
    expect(r.error).toBeTruthy()
    expect(r.error).not.toContain("LEAKED_TOKEN")
  })

  it("is a no-op without credentials", async () => {
    expect((await grantedPageIds(GRAPH, "", "SECRET", "T")).pageIds).toEqual([])
    expect((await grantedPageIds(GRAPH, "APP", "SECRET", "")).pageIds).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("fetchGrantedPage", () => {
  it("returns the Page with its token and linked Instagram account", async () => {
    jsonOnce({
      id: "373662722735767",
      name: "Lead Drive CRM",
      access_token: "PAGE_TOKEN",
      instagram_business_account: { id: "17841410801241198", username: "leaddrive.az" },
    })
    const page = await fetchGrantedPage(GRAPH, "373662722735767", "USERTOKEN")
    expect(page).toMatchObject({ id: "373662722735767", name: "Lead Drive CRM", access_token: "PAGE_TOKEN" })
    expect(page?.instagram_business_account?.id).toBe("17841410801241198")
    // The user token goes in the Authorization header, not the query string.
    const init = fetchMock.mock.calls[0][1]
    expect(init.headers.Authorization).toBe("Bearer USERTOKEN")
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("USERTOKEN")
  })

  it("returns null when the Page carries no access token", async () => {
    jsonOnce({ id: "P1", name: "No token" })
    expect(await fetchGrantedPage(GRAPH, "P1", "T")).toBeNull()
  })
})

describe("enumerateGrantedPages", () => {
  it("resolves the Page that /me/accounts could not see", async () => {
    jsonOnce({ data: { granular_scopes: [{ scope: "pages_messaging", target_ids: ["373662722735767"] }] } })
    jsonOnce({ id: "373662722735767", name: "Lead Drive CRM", access_token: "PAGE_TOKEN" })
    const r = await enumerateGrantedPages(GRAPH, "APP", "SECRET", "USERTOKEN")
    expect(r.pages).toHaveLength(1)
    expect(r.pages[0].id).toBe("373662722735767")
  })

  it("keeps the Pages it can fetch when one fails", async () => {
    jsonOnce({ data: { granular_scopes: [{ scope: "pages_messaging", target_ids: ["P1", "P2"] }] } })
    jsonOnce({ id: "P1", name: "One", access_token: "T1" })
    jsonOnce({ error: "gone" }, false, 404)
    const r = await enumerateGrantedPages(GRAPH, "APP", "SECRET", "T")
    expect(r.pages.map(p => p.id)).toEqual(["P1"])
  })

  it("reports the granted scopes when nothing was selected, so the failure can be explained", async () => {
    jsonOnce({ data: { scopes: ["public_profile", "business_management"], granular_scopes: [] } })
    const r = await enumerateGrantedPages(GRAPH, "APP", "SECRET", "T")
    expect(r.pages).toEqual([])
    // This is what turns a bare "no_admined_pages" into "you granted business_management but no Page".
    expect(r.grantedScopes).toContain("business_management")
  })
})
