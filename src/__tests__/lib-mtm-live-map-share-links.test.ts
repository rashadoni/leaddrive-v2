/**
 * «Ссылка на местоположение» as the employee's card reads the server: what
 * counts as an answer, and what each refusal is called.
 *
 * The block makes a person's position visible to somebody outside the
 * organization, so it reads closed: a row it cannot vouch for is not drawn
 * with a «Отозвать» under it, an address that is not the public page's is not
 * offered for copying, and «may I» is yes only on the server's exact word.
 */
import { describe, expect, it } from "vitest"
import {
  aliveLiveMapShareLinks,
  isLiveMapShareLinkOutOfTime,
  liveMapShareLinkProblem,
  parseCreatedLiveMapShareLink,
  parseLiveMapShareLink,
  parseLiveMapShareLinks,
  pastLiveMapShareLinks,
  withLiveMapShareLink,
  withRevokedLiveMapShareLink,
  withoutLiveMapShareLink,
  type LiveMapShareLink,
} from "@/lib/mtm/live-map-share-links"

const TOKEN = "c".repeat(64)
/** A link as GET …/share-links sends it (presentLocationShareLink, through JSON). */
const sent = (over: Record<string, unknown> = {}) => ({
  id: "link-1",
  createdAt: "2026-10-12T09:00:00.000Z",
  expiresAt: "2026-10-12T13:00:00.000Z",
  revokedAt: null,
  viewCount: 3,
  lastViewedAt: "2026-10-12T09:40:00.000Z",
  createdByName: "Старший Первый",
  alive: true,
  ...over,
})
const kept = (over: Partial<LiveMapShareLink> = {}): LiveMapShareLink => ({
  id: "link-1", expiresAt: "2026-10-12T13:00:00.000Z", revokedAt: null, viewCount: 3,
  lastViewedAt: "2026-10-12T09:40:00.000Z", createdByName: "Старший Первый", alive: true, ...over,
})

describe("a link, as the list sends it", () => {
  it("is read field by field: until when, who made it, how many times it was opened", () => {
    expect(parseLiveMapShareLink(sent())).toEqual(kept())
  })

  it("carries nothing else the answer happened to hold", () => {
    const read = parseLiveMapShareLink(sent({ tokenHash: "f".repeat(64), url: `https://app.example.test/share/location/${TOKEN}`, createdBy: "user-1", agentId: "agent-1" }))
    expect(Object.keys(read ?? {}).sort()).toEqual(["alive", "createdByName", "expiresAt", "id", "lastViewedAt", "revokedAt", "viewCount"])
  })

  it("is refused when it does not say what a row has to say — never drawn on a guess", () => {
    for (const broken of [
      null, "link-1", [], {},
      sent({ id: "" }), sent({ id: 7 }),
      sent({ expiresAt: null }), sent({ expiresAt: "скоро" }),
      // «Still works?» is the server's word; a row without it would get a «Отозвать» nobody can vouch for.
      sent({ alive: undefined }), sent({ alive: "true" }), sent({ alive: 1 }),
      sent({ viewCount: null }), sent({ viewCount: "3" }), sent({ viewCount: -1 }), sent({ viewCount: 2.5 }),
    ]) {
      expect(parseLiveMapShareLink(broken), JSON.stringify(broken)).toBeNull()
    }
  })

  it("does without what may honestly be missing: nobody opened it yet, the author's name could not be read", () => {
    expect(parseLiveMapShareLink(sent({ viewCount: 0, lastViewedAt: null, createdByName: null })))
      .toEqual(kept({ viewCount: 0, lastViewedAt: null, createdByName: null }))
    // A name of spaces is no name; a moment that is not one is no moment.
    expect(parseLiveMapShareLink(sent({ createdByName: "   ", lastViewedAt: "вчера", revokedAt: 5 })))
      .toEqual(kept({ createdByName: null, lastViewedAt: null, revokedAt: null }))
  })
})

describe("the list", () => {
  it("is the links in the server's order, with what this viewer may do", () => {
    const answer = parseLiveMapShareLinks({
      links: [sent(), sent({ id: "link-0", alive: false, revokedAt: "2026-10-12T08:00:00.000Z" })],
      access: { enabled: true, canWrite: true },
    })
    expect(answer?.links.map((link) => link.id)).toEqual(["link-1", "link-0"])
    expect([answer?.enabled, answer?.canWrite]).toEqual([true, true])
  })

  it("says «may» and «switched on» only on the server's exact yes", () => {
    for (const access of [undefined, null, {}, "yes", { enabled: "true", canWrite: 1 }, { enabled: null, canWrite: "да" }]) {
      const answer = parseLiveMapShareLinks({ links: [], access })
      expect([answer?.enabled, answer?.canWrite], JSON.stringify(access)).toEqual([false, false])
    }
    expect(parseLiveMapShareLinks({ links: [], access: { enabled: false, canWrite: true } })).toMatchObject({ enabled: false, canWrite: true })
    expect(parseLiveMapShareLinks({ links: [], access: { enabled: true, canWrite: false } })).toMatchObject({ enabled: true, canWrite: false })
  })

  it("says whether a link shows a point right now only on the server's exact yes or no — anything else is «it did not say»", () => {
    const read = (showsNow: unknown) => parseLiveMapShareLinks({ links: [], access: { enabled: true, canWrite: true }, ...(showsNow === undefined ? {} : { showsNow }) })?.showsNow
    expect(read(true)).toBe(true)
    expect(read(false)).toBe(false)
    // «No» is what prints the amber line: it is never read out of a missing or a mangled field.
    for (const mangled of [undefined, null, "false", "true", 0, 1, "", [], {}]) {
      expect(read(mangled), JSON.stringify(mangled)).toBeNull()
    }
    // Nor out of the same word somewhere else in the answer.
    expect(parseLiveMapShareLinks({ links: [], access: { enabled: true, canWrite: true, showsNow: false } })?.showsNow).toBeNull()
  })

  it("leaves out a row it cannot read and keeps the rest", () => {
    const answer = parseLiveMapShareLinks({ links: [sent(), { id: "half" }, sent({ id: "link-2" })], access: { enabled: true, canWrite: true } })
    expect(answer?.links.map((link) => link.id)).toEqual(["link-1", "link-2"])
  })

  it("is no answer at all when it is not a list of links", () => {
    for (const broken of [null, undefined, "", [], { links: null }, { links: "none" }, { access: { enabled: true, canWrite: true } }]) {
      expect(parseLiveMapShareLinks(broken), JSON.stringify(broken)).toBeNull()
    }
  })

  it("tells the working ones from the ones that no longer work by the server's verdict alone", () => {
    const links = [kept({ id: "a" }), kept({ id: "b", alive: false, revokedAt: "2026-10-12T08:00:00.000Z" }), kept({ id: "c" }), kept({ id: "d", alive: false })]
    expect(aliveLiveMapShareLinks(links).map((link) => link.id)).toEqual(["a", "c"])
    expect(pastLiveMapShareLinks(links).map((link) => link.id)).toEqual(["b", "d"])
  })
})

describe("a link whose time has run out since the answer", () => {
  const ENDS = Date.parse("2026-10-12T13:00:00.000Z")
  const links = [
    kept({ id: "working" }),
    kept({ id: "longer", expiresAt: "2026-10-12T20:00:00.000Z" }),
    kept({ id: "revoked", alive: false, revokedAt: "2026-10-12T08:00:00.000Z" }),
  ]

  it("is past by the page's clock from the very moment it ends — not a millisecond earlier", () => {
    expect(isLiveMapShareLinkOutOfTime(links[0], ENDS - 1)).toBe(false)
    expect(isLiveMapShareLinkOutOfTime(links[0], ENDS)).toBe(true)
    expect(aliveLiveMapShareLinks(links, ENDS - 1).map((link) => link.id)).toEqual(["working", "longer"])
    expect(pastLiveMapShareLinks(links, ENDS - 1).map((link) => link.id)).toEqual(["revoked"])
    expect(aliveLiveMapShareLinks(links, ENDS).map((link) => link.id)).toEqual(["longer"])
    // In the answer's own order: the one that has just ended is the freshest news of the three.
    expect(pastLiveMapShareLinks(links, ENDS).map((link) => link.id)).toEqual(["working", "revoked"])
  })

  it("every link is in exactly one of the two lists, whatever the clock", () => {
    for (const nowMs of [undefined, Number.NaN, 0, ENDS - 1, ENDS, ENDS + 86_400_000]) {
      const both = [...aliveLiveMapShareLinks(links, nowMs), ...pastLiveMapShareLinks(links, nowMs)].map((link) => link.id).sort()
      expect(both, String(nowMs)).toEqual(["longer", "revoked", "working"])
    }
  })

  it("a clock that is no clock takes no link away: then the server's verdict is all there is", () => {
    for (const nowMs of [undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(aliveLiveMapShareLinks(links, nowMs).map((link) => link.id), String(nowMs)).toEqual(["working", "longer"])
      expect(isLiveMapShareLinkOutOfTime(links[0], nowMs), String(nowMs)).toBe(false)
    }
  })

  it("is not what a link the server already stopped is called: that one is simply past", () => {
    expect(isLiveMapShareLinkOutOfTime(links[2], ENDS + 86_400_000)).toBe(false)
    expect(pastLiveMapShareLinks(links, ENDS + 86_400_000).map((link) => link.id)).toEqual(["working", "longer", "revoked"])
  })
})

describe("what a creation gives back", () => {
  const ORIGIN = "https://tenant.example.test"
  const created = (url: unknown, link: unknown = sent({ viewCount: 0, lastViewedAt: null })) => parseCreatedLiveMapShareLink({ link, url }, ORIGIN)

  it("is the new link and — this once — the link itself, exactly as the server built it", () => {
    const url = `https://app.example.test/share/location/${TOKEN}?lang=az`
    expect(created(url)).toEqual({ link: kept({ viewCount: 0, lastViewedAt: null }), url })
  })

  it("completes a bare path with the page's own address (a machine with no address configured)", () => {
    expect(created(`/share/location/${TOKEN}?lang=ru`)?.url).toBe(`${ORIGIN}/share/location/${TOKEN}?lang=ru`)
  })

  it("offers nothing to copy that is not an address of the public page", () => {
    for (const url of [
      null, undefined, "", 42,
      "javascript:alert(1)//share/location/x",
      "data:text/html,/share/location/x",
      `https://app.example.test/mtm/map?next=/share/location/${TOKEN}`,
      `https://app.example.test/share/locations/${TOKEN}`,
      "https://app.example.test/",
    ]) {
      expect(created(url), String(url)).toBeNull()
    }
  })

  it("is nothing without a readable link beside the address", () => {
    const url = `https://app.example.test/share/location/${TOKEN}?lang=ru`
    expect(created(url, null)).toBeNull()
    expect(created(url, sent({ alive: undefined }))).toBeNull()
    expect(parseCreatedLiveMapShareLink(null, ORIGIN)).toBeNull()
    expect(parseCreatedLiveMapShareLink([], ORIGIN)).toBeNull()
  })
})

describe("why the server refused, as the block says it", () => {
  it("names each refusal of the three routes", () => {
    expect(liveMapShareLinkProblem("create", 403, "MTM_LOCATION_SHARE_LINK_DISABLED")).toBe("off")
    expect(liveMapShareLinkProblem("create", 403, "MTM_LOCATION_SHARE_LINK_READ_ONLY")).toBe("readOnly")
    expect(liveMapShareLinkProblem("create", 403, "MTM_LOCATION_SHARE_LINK_MANAGER_REQUIRED")).toBe("readOnly")
    expect(liveMapShareLinkProblem("revoke", 403, undefined)).toBe("readOnly")
    expect(liveMapShareLinkProblem("create", 409, "MTM_LOCATION_SHARE_LINK_LIMIT_REACHED")).toBe("limit")
    expect(liveMapShareLinkProblem("create", 429, "MTM_LOCATION_SHARE_LINK_RATE_LIMITED")).toBe("busy")
    expect(liveMapShareLinkProblem("revoke", 429, undefined)).toBe("busy")
    expect(liveMapShareLinkProblem("list", 401, undefined)).toBe("session")
    expect(liveMapShareLinkProblem("create", 500, "MTM_LOCATION_SHARE_LINK_FAILED")).toBe("failed")
    expect(liveMapShareLinkProblem("create", 400, undefined)).toBe("failed")
    // A conflict that is not the limit is not called the limit.
    expect(liveMapShareLinkProblem("create", 409, "SOMETHING_ELSE")).toBe("failed")
  })

  it("reads the one 404 by what was asked: the employee when a link was being made or listed, the link when one was being revoked", () => {
    const code = "MTM_LOCATION_SHARE_LINK_NOT_FOUND"
    expect(liveMapShareLinkProblem("create", 404, code)).toBe("agentGone")
    expect(liveMapShareLinkProblem("list", 404, code)).toBe("agentGone")
    expect(liveMapShareLinkProblem("revoke", 404, code)).toBe("linkGone")
  })

  it("takes «it went through» without the server's own success for the sign-in page served instead of an answer", () => {
    expect(liveMapShareLinkProblem("create", 200, undefined)).toBe("session")
    expect(liveMapShareLinkProblem("revoke", 201, undefined)).toBe("session")
  })
})

describe("the list in hand after a change", () => {
  const links = [kept({ id: "a" }), kept({ id: "b" }), kept({ id: "old", alive: false, revokedAt: "2026-10-12T08:00:00.000Z" })]

  it("puts a link just made at the head, once", () => {
    expect(withLiveMapShareLink(links, kept({ id: "new" })).map((link) => link.id)).toEqual(["new", "a", "b", "old"])
    expect(withLiveMapShareLink(links, kept({ id: "b", viewCount: 9 })).map((link) => [link.id, link.viewCount])).toEqual([["b", 9], ["a", 3], ["old", 3]])
  })

  it("keeps a revoked link as one that no longer works, with the moment the server stopped it", () => {
    const after = withRevokedLiveMapShareLink(links, "a", "2026-10-12T10:15:00.000Z")
    expect(aliveLiveMapShareLinks(after).map((link) => link.id)).toEqual(["b"])
    expect(pastLiveMapShareLinks(after).map((link) => [link.id, link.revokedAt])).toEqual([
      ["a", "2026-10-12T10:15:00.000Z"], ["old", "2026-10-12T08:00:00.000Z"],
    ])
    // The list it was made from is not touched.
    expect(links[0]).toEqual(kept({ id: "a" }))
  })

  it("takes away a link the server no longer knows, instead of showing it under a made-up reason", () => {
    expect(withoutLiveMapShareLink(links, "a").map((link) => link.id)).toEqual(["b", "old"])
    expect(withoutLiveMapShareLink(links, "nobody")).toEqual(links)
  })
})
