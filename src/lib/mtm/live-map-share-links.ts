import { LOCATION_SHARE_LINK_PAGE_PATH } from "@/lib/mtm/location-share-link"

/**
 * «Ссылка на местоположение» as the employee's card on the live map holds it:
 * how the server's answers are read, and what a refusal is called.
 *
 * The rules of a link itself — how long it lives, who may make one, what an
 * outsider is shown — are the server's (location-share-link.ts,
 * location-share-access.ts). Nothing here decides any of that: this file only
 * reads what the routes under /api/v1/mtm/locations/share-links said, and
 * reads it closed — an answer that is not what it should be is no answer,
 * and a row that cannot be read is left out, never guessed at.
 *
 * Pure: no React, no request.
 */

/** A link as the list shows it. The link itself is not here: only its hash was ever kept. */
export interface LiveMapShareLink {
  id: string
  expiresAt: string
  /** Set once somebody revoked it. */
  revokedAt: string | null
  /**
   * How many times it was opened — sittings, not requests: a page left open
   * for an hour is one, and one opened again after five quiet minutes is two.
   */
  viewCount: number
  lastViewedAt: string | null
  /** Who made it; null when the name could not be read. */
  createdByName: string | null
  /** The server's own verdict when it answered: neither revoked nor out of time. */
  alive: boolean
}

/** GET /api/v1/mtm/locations/share-links?agentId=, as the card reads it. */
export interface LiveMapShareLinksAnswer {
  /** The working links first, then the last few that no longer work. */
  links: LiveMapShareLink[]
  /** The organization's switch. Anything but an explicit yes is no. */
  enabled: boolean
  /** Whether this viewer may make and revoke; anything but an explicit yes is no. */
  canWrite: boolean
  /**
   * Whether a link to this employee shows a point at this very moment — the
   * server's own answer, by the same rule as the outsider's page. Null when
   * the answer does not say (links switched off, the position could not be
   * read, an older server): the card then says nothing about it, either way.
   */
  showsNow: boolean | null
}

const moment = (value: unknown): string | null =>
  typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null

/**
 * One link of an answer, or null when it cannot be shown as what it says it
 * is: a row without an id, without a moment of expiry, or one that does not
 * say whether it still works would be drawn with a «Отозвать» nobody can
 * vouch for.
 */
export function parseLiveMapShareLink(value: unknown): LiveMapShareLink | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (typeof row.id !== "string" || !row.id) return null
  const expiresAt = moment(row.expiresAt)
  if (!expiresAt) return null
  if (typeof row.alive !== "boolean") return null
  if (typeof row.viewCount !== "number" || !Number.isInteger(row.viewCount) || row.viewCount < 0) return null
  const author = typeof row.createdByName === "string" ? row.createdByName.trim() : ""
  return {
    id: row.id,
    expiresAt,
    revokedAt: moment(row.revokedAt),
    viewCount: row.viewCount,
    lastViewedAt: moment(row.lastViewedAt),
    createdByName: author || null,
    alive: row.alive,
  }
}

/** The list, or null when the answer is not a list of links at all. */
export function parseLiveMapShareLinks(value: unknown): LiveMapShareLinksAnswer | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const data = value as Record<string, unknown>
  if (!Array.isArray(data.links)) return null
  const links: LiveMapShareLink[] = []
  for (const row of data.links) {
    const link = parseLiveMapShareLink(row)
    if (link) links.push(link)
  }
  const access = data.access && typeof data.access === "object" ? data.access as Record<string, unknown> : null
  return {
    links,
    enabled: access?.enabled === true,
    canWrite: access?.canWrite === true,
    showsNow: typeof data.showsNow === "boolean" ? data.showsNow : null,
  }
}

/**
 * What POST …/share-links gave back: the new link and — this once — the link
 * itself, as an address a person can be sent.
 *
 * The server builds the address on the application's own host. Where no host
 * is configured (a developer's machine) it sends the path alone, and `origin`
 * — the page's own — completes it. Anything that is not an address of the
 * public page is refused: the field would otherwise offer to copy whatever
 * the answer happened to carry.
 */
export function parseCreatedLiveMapShareLink(value: unknown, origin: string): { link: LiveMapShareLink; url: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const data = value as Record<string, unknown>
  const link = parseLiveMapShareLink(data.link)
  if (!link || typeof data.url !== "string" || !data.url) return null
  let url: URL
  try {
    url = new URL(data.url, origin)
  } catch {
    return null
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null
  if (!url.pathname.startsWith(LOCATION_SHARE_LINK_PAGE_PATH)) return null
  return { link, url: url.href }
}

/**
 * Why the server did not do what the block asked, as the block says it:
 *   - "off" — the organization switched the links off meanwhile;
 *   - "readOnly" — this viewer may look and not make or revoke;
 *   - "limit" — the employee already has as many working links as he may;
 *   - "agentGone" — the employee is not this viewer's to show any more:
 *     outside his scope, or deactivated;
 *   - "linkGone" — the link was revoked by somebody else, or its time ran out;
 *   - "busy" — too many requests in a minute;
 *   - "session" — nobody is signed in any more;
 *   - "network" — the request never got an answer;
 *   - "failed" — anything else.
 */
export type LiveMapShareLinkProblem = "off" | "readOnly" | "limit" | "agentGone" | "linkGone" | "busy" | "session" | "network" | "failed"

/**
 * `asked` is what was asked for: the routes answer one 404 for an employee
 * who is not there and for a link that is not, and only the question tells
 * which of the two it was.
 */
export function liveMapShareLinkProblem(asked: "list" | "create" | "revoke", status: number, code: unknown): LiveMapShareLinkProblem {
  // «It went through» without the server's own «success» is the sign-in page
  // served in place of the answer: the session has ended.
  if (status === 401 || (status >= 200 && status < 300)) return "session"
  if (status === 403) return code === "MTM_LOCATION_SHARE_LINK_DISABLED" ? "off" : "readOnly"
  if (status === 404) return asked === "revoke" ? "linkGone" : "agentGone"
  if (status === 409 && code === "MTM_LOCATION_SHARE_LINK_LIMIT_REACHED") return "limit"
  if (status === 429) return "busy"
  return "failed"
}

/**
 * A link the answer called working whose time has run out since, by the
 * clock of the page that holds the answer (`nowMs` — the server's moment plus
 * the time passed since, as the live map counts it). The answer is read
 * again every couple of minutes; without this a link that ended a moment ago
 * would stand under «Действующие ссылки», with «Скопировать» beside it, for
 * as long. No clock given: the answer's own verdict is all there is.
 */
export function isLiveMapShareLinkOutOfTime(link: LiveMapShareLink, nowMs?: number): boolean {
  return link.alive && typeof nowMs === "number" && Number.isFinite(nowMs) && Date.parse(link.expiresAt) <= nowMs
}

/** The links that work, in the order the answer gave them: the newest first. */
export function aliveLiveMapShareLinks(links: readonly LiveMapShareLink[], nowMs?: number): LiveMapShareLink[] {
  return links.filter((link) => link.alive && !isLiveMapShareLinkOutOfTime(link, nowMs))
}

/** The ones that no longer work — revoked, or out of time. */
export function pastLiveMapShareLinks(links: readonly LiveMapShareLink[], nowMs?: number): LiveMapShareLink[] {
  return links.filter((link) => !link.alive || isLiveMapShareLinkOutOfTime(link, nowMs))
}

/**
 * The list with the link that was just made, at its head — what a creation
 * has given back. The block draws that, and does not read the list again.
 */
export function withLiveMapShareLink(links: readonly LiveMapShareLink[], link: LiveMapShareLink): LiveMapShareLink[] {
  return [link, ...links.filter((kept) => kept.id !== link.id)]
}

/**
 * The list after a link was revoked: the link stays, as one that no longer
 * works, with the moment the server stopped it.
 */
export function withRevokedLiveMapShareLink(links: readonly LiveMapShareLink[], linkId: string, revokedAt: string): LiveMapShareLink[] {
  return links.map((kept) => (kept.id === linkId ? { ...kept, alive: false, revokedAt } : kept))
}

/**
 * The list without a link the server no longer knows as this viewer's to
 * revoke. Why it is gone the answer does not say, so the row is taken away
 * rather than shown under a reason made up here; the list is then read again.
 */
export function withoutLiveMapShareLink(links: readonly LiveMapShareLink[], linkId: string): LiveMapShareLink[] {
  return links.filter((kept) => kept.id !== linkId)
}
