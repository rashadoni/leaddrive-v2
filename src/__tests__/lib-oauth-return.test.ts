import { describe, expect, it } from "vitest"
import { normalizeOAuthReturnKey, oauthReturnUrl } from "@/lib/social/oauth-return"

/**
 * The OAuth callbacks turn this helper's output into an absolute URL with
 * `new URL(path, origin)`. That resolver treats `//host`, `/\host` and any absolute URL as a NEW
 * origin — so if a caller-supplied path ever reached it, the signed OAuth state would be shipping
 * an open redirect. Hence: keys from a closed whitelist, never paths. These tests pin that.
 */
describe("oauth return target whitelist", () => {
  it("accepts only exact whitelist keys", () => {
    expect(normalizeOAuthReturnKey("channels-facebook")).toBe("channels-facebook")
    expect(normalizeOAuthReturnKey("channels-instagram")).toBe("channels-instagram")
    expect(normalizeOAuthReturnKey(null)).toBeNull()
    expect(normalizeOAuthReturnKey(undefined)).toBeNull()
    expect(normalizeOAuthReturnKey("")).toBeNull()
    expect(normalizeOAuthReturnKey("Channels-Facebook")).toBeNull()
    expect(normalizeOAuthReturnKey("channels-facebook ")).toBeNull()
  })

  it("does not treat inherited Object properties as keys", () => {
    expect(normalizeOAuthReturnKey("constructor")).toBeNull()
    expect(normalizeOAuthReturnKey("__proto__")).toBeNull()
    expect(normalizeOAuthReturnKey("toString")).toBeNull()
  })

  it("falls back to /social-monitoring for unknown or missing keys", () => {
    expect(oauthReturnUrl(null, { connected: "facebook" })).toBe("/social-monitoring?connected=facebook")
    expect(oauthReturnUrl(undefined, {})).toBe("/social-monitoring")
    expect(oauthReturnUrl("whatever", { error: "expired" })).toBe("/social-monitoring?error=expired")
  })

  it("never lets an attacker-supplied path become the destination", () => {
    for (const hostile of ["//evil.com", "/\\evil.com", "https://evil.com", "../../evil", "http:evil"]) {
      expect(oauthReturnUrl(hostile, { error: "x" })).toBe("/social-monitoring?error=x")
    }
  })

  it("merges result params into the whitelisted channel-card target", () => {
    const url = oauthReturnUrl("channels-instagram", { connected: "facebook", pages: "2", ig: "1" })
    const [path, query] = url.split("?")
    expect(path).toBe("/settings/channels/connect/instagram")
    const params = new URLSearchParams(query)
    // The target's own params survive alongside the merged result params.
    expect(params.get("mode")).toBe("existing")
    expect(params.get("stage")).toBe("connect")
    expect(params.get("connected")).toBe("facebook")
    expect(params.get("pages")).toBe("2")
    expect(params.get("ig")).toBe("1")
  })

  it("encodes param values, so callers must not pre-encode them", () => {
    const url = oauthReturnUrl("channels-facebook", { error: "facebook_denied: needs review" })
    expect(url).toContain("/settings/channels/connect/facebook?")
    expect(url).not.toContain("facebook_denied: needs review")
    const params = new URLSearchParams(url.split("?")[1])
    expect(params.get("error")).toBe("facebook_denied: needs review")
  })
})
