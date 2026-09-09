import { describe, expect, it } from "vitest"
import {
  ingestEnvelopeOtherAuthorsWhere,
  isOfficialMonitoringAuthor,
  mentionAuthorScopeWhere,
  monitoringAuthorIdentity,
  monitoringSourceMatchesOwnedIdentity,
  ownedWebSearchExclusionHosts,
} from "@/lib/social/mention-author-scope"

describe("monitoring mention author scope", () => {
  const identity = monitoringAuthorIdentity({
    name: "Araz Supermarket",
    aliases: [
      { kind: "HASHTAG", value: "arazsupermarket" },
      { kind: "DOMAIN", value: "aramarket.az" },
    ],
    sources: [
      {
        source: {
          id: "instagram-profile",
          platform: "instagram",
          sourceType: "profile",
          handle: null,
          url: "https://www.instagram.com/arazsupermarket/",
        },
      },
      {
        source: {
          id: "official-web",
          platform: "web",
          sourceType: "domain",
          handle: null,
          url: "https://www.aramarket.az/",
        },
      },
    ],
  })

  it("recognizes the exact brand name and explicit profile handle as official", () => {
    expect(isOfficialMonitoringAuthor({ authorHandle: "Araz Supermarket" }, identity)).toBe(false)
    expect(isOfficialMonitoringAuthor({ authorHandle: "arazsupermarket" }, identity)).toBe(true)
    expect(isOfficialMonitoringAuthor({ authorHandle: "nirezo_official" }, identity)).toBe(false)
  })

  it("does not classify a same-name external author as official", () => {
    expect(isOfficialMonitoringAuthor({ authorName: "Araz Supermarket" }, identity)).toBe(false)
  })

  it("does not classify an external comment under an official post as official", () => {
    expect(isOfficialMonitoringAuthor({ authorHandle: "customer_123", evidenceSourceIds: ["instagram-profile"] }, identity)).toBe(false)
  })

  it("builds official author, profile, domain and provenance identities", () => {
    expect(identity.sourceIds).toEqual(["instagram-profile", "official-web"])
    expect(identity.authorNames).toEqual(["arazsupermarket"])
    expect(identity.sourceAuthorNames).toEqual([])
    expect(identity.webHosts).toEqual(["aramarket.az"])
    expect(identity.profileUrls).toEqual(["https://instagram.com/arazsupermarket"])
  })

  it("builds distinct official and other-author database scopes", () => {
    expect(mentionAuthorScopeWhere("official", identity)).toHaveProperty("OR")
    const others = mentionAuthorScopeWhere("others", identity)
    expect(others).toHaveProperty("AND")
    expect(mentionAuthorScopeWhere("all", identity)).toEqual({})
  })

  it("uses a handle alias as official identity without a linked page", () => {
    const handleOnly = monitoringAuthorIdentity({
      name: "Araz Supermarket",
      aliases: [{ kind: "HANDLE", value: "@arazsupermarket" }],
      sources: [],
    })

    expect(handleOnly.authorNames).toEqual(["arazsupermarket"])
    expect(handleOnly.sourceAuthorNames).toEqual([])
    expect(isOfficialMonitoringAuthor({ authorHandle: "arazsupermarket" }, handleOnly)).toBe(true)
    expect(isOfficialMonitoringAuthor({ authorName: "Araz Supermarket" }, handleOnly)).toBe(false)
    expect(isOfficialMonitoringAuthor({
      authorHandle: "arazsupermarket_fans",
      authorName: "arazsupermarket",
    }, handleOnly)).toBe(false)
    expect(JSON.stringify(mentionAuthorScopeWhere("others", handleOnly))).toContain("arazsupermarket")
    expect(JSON.stringify(mentionAuthorScopeWhere("others", handleOnly))).not.toContain("authorName")
  })

  it("uses official source and URL evidence for publications, not comments", () => {
    const official = JSON.stringify(mentionAuthorScopeWhere("official", identity))
    expect(official).not.toContain('"sourceProvider":"native"')
    expect(official).toContain('"sourceType":{"notIn":["comment","reply"]}')
    expect(official).toContain('"sourceId":{"in":["instagram-profile","official-web"]}')
    expect(official).toContain("https://aramarket.az")
    expect(official).toContain("https://instagram.com/arazsupermarket")

    const others = JSON.stringify(mentionAuthorScopeWhere("others", identity))
    expect(others).toContain('"NOT"')
    expect(others).not.toContain('"sourceProvider":"native"')
    expect(others).toContain('"contentKind":{"notIn":["COMMENT","REPLY"]}')
  })

  it("excludes owned publications from review envelopes but preserves comments under them", () => {
    const where = JSON.stringify(ingestEnvelopeOtherAuthorsWhere(identity))
    expect(where).toContain('"sourceId":{"in":["instagram-profile","official-web"]}')
    expect(where).toContain('"contentKind":{"notIn":["COMMENT","REPLY"]}')
    expect(where).not.toContain("parentPostUrl")
  })

  it("does not add mention author-null guards for a provenance-only identity", () => {
    const provenanceOnly = {
      authorNames: [],
      sourceIds: ["official-source"],
      webHosts: [],
      profileUrls: [],
    }

    const where = mentionAuthorScopeWhere("others", provenanceOnly)
    expect(where.AND).toHaveLength(1)
    expect(where.AND).toEqual([
      expect.objectContaining({ NOT: expect.any(Object) }),
    ])
    const serialized = JSON.stringify(where)
    expect(serialized).toContain('"sourceId":{"in":["official-source"]}')
    expect(serialized).not.toContain("authorHandle")
    expect(serialized).not.toContain("authorName")
  })

  it("does not add review-envelope author-null guards for a provenance-only identity", () => {
    const provenanceOnly = {
      authorNames: [],
      sourceIds: ["official-source"],
      webHosts: [],
      profileUrls: [],
    }

    const where = ingestEnvelopeOtherAuthorsWhere(provenanceOnly)
    expect(where.AND).toHaveLength(1)
    expect(where.AND).toEqual([
      expect.objectContaining({ NOT: expect.any(Object) }),
    ])
    const serialized = JSON.stringify(where)
    expect(serialized).toContain('"sourceId":{"in":["official-source"]}')
    expect(serialized).not.toContain("authorHandle")
    expect(serialized).not.toContain("authorName")
  })

  it("detects legacy external rows that point at an owned website or profile", () => {
    expect(monitoringSourceMatchesOwnedIdentity({
      platform: "web",
      sourceType: "domain",
      url: "https://shop.aramarket.az/offers",
    }, identity)).toBe(true)
    expect(monitoringSourceMatchesOwnedIdentity({
      platform: "instagram",
      sourceType: "competitor",
      handle: "@arazsupermarket",
    }, identity)).toBe(true)
    expect(monitoringSourceMatchesOwnedIdentity({
      platform: "web",
      sourceType: "keyword",
      query: "Araz Supermarket",
    }, identity)).toBe(false)
    expect(ownedWebSearchExclusionHosts(identity)).toEqual(["aramarket.az"])
  })

  it("recognizes a legacy domain stored as a generic brand alias", () => {
    const legacy = monitoringAuthorIdentity({
      name: "Baku Electronics",
      aliases: [{ kind: "NAME", value: "bakuelectronics.az" }],
      sources: [{
        source: {
          id: "owned-query-source",
          platform: "web",
          sourceType: "domain",
          handle: null,
          url: null,
          query: "shop.bakuelectronics.az",
        },
      }],
    })
    expect(legacy.webHosts).toEqual(["bakuelectronics.az", "shop.bakuelectronics.az"])
  })

  it("fails closed for official scope when no official identity is configured", () => {
    const empty = { authorNames: [], sourceIds: [], webHosts: [], profileUrls: [] }
    expect(mentionAuthorScopeWhere("official", empty)).toEqual({ id: "__no_official_author_identity__" })
    expect(mentionAuthorScopeWhere("others", empty)).toEqual({})
  })
})
