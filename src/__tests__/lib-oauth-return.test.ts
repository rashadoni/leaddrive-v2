import { describe, expect, it } from "vitest"
import {
  normalizeOAuthReturnChannelId,
  normalizeOAuthReturnKey,
  oauthReturnChannelType,
  oauthReturnUrl,
  pickOAuthReturnChannelId,
} from "@/lib/social/oauth-return"

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

/**
 * The row a channel card is handed back (`channelId`). Without it the page picked "some row of this
 * type" and, on a workspace holding several customers' Pages, opened another customer's channel.
 */
describe("oauth return channel id", () => {
  it("maps each channel card to the only row type it may be handed", () => {
    expect(oauthReturnChannelType("channels-facebook")).toBe("facebook")
    expect(oauthReturnChannelType("channels-instagram")).toBe("instagram")
    expect(oauthReturnChannelType(null)).toBeNull()
    expect(oauthReturnChannelType("constructor")).toBeNull()
  })

  it("accepts only the shape a row id can have", () => {
    expect(normalizeOAuthReturnChannelId("cmua55s6t03n0kpvtm63bclud")).toBe("cmua55s6t03n0kpvtm63bclud")
    expect(normalizeOAuthReturnChannelId(" cmua55s6t03n0kpvtm63bclud ")).toBe("cmua55s6t03n0kpvtm63bclud")
    for (const hostile of ["", "../x", "a b", "x&stage=intro", "//evil.com", "a".repeat(65), 42, null, undefined, {}]) {
      expect(normalizeOAuthReturnChannelId(hostile)).toBeNull()
    }
  })

  it("attaches the id to a channel card, never to the Social Monitoring default", () => {
    const params = new URLSearchParams(oauthReturnUrl("channels-facebook", { connected: "facebook" }, "cc_1").split("?")[1])
    expect(params.get("channelId")).toBe("cc_1")
    expect(params.get("mode")).toBe("existing")
    expect(oauthReturnUrl(null, { connected: "facebook" }, "cc_1")).toBe("/social-monitoring?connected=facebook")
    expect(oauthReturnUrl("channels-facebook", { error: "x" }, "a b")).not.toContain("channelId")
  })

  it("names the origin when this round trip wired it", () => {
    expect(pickOAuthReturnChannelId("origin", ["other", "origin"])).toBe("origin")
  })

  it("otherwise names the single row it wired", () => {
    expect(pickOAuthReturnChannelId("origin", ["wired"])).toBe("wired")
    expect(pickOAuthReturnChannelId(null, ["wired", "wired"])).toBe("wired")
  })

  it("falls back to the origin only when nothing of this type was wired", () => {
    expect(pickOAuthReturnChannelId("origin", [])).toBe("origin")
    expect(pickOAuthReturnChannelId(null, [])).toBeNull()
  })

  it("names none when several rows were wired and the origin is not among them", () => {
    expect(pickOAuthReturnChannelId(null, ["a", "b"])).toBeNull()
    expect(pickOAuthReturnChannelId("origin", ["a", "b"])).toBeNull()
  })
})
