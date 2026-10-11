import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import { LocationShareLinkCreateSchema, parseBody } from "@/lib/mtm-validators"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { MTM_SETTING_DEFAULTS, getMtmSettings } from "@/lib/mtm-settings"
import { coerceMtmBooleanSetting } from "@/lib/mtm/setting-values"
import { isAgentInRouteScope } from "@/lib/mtm/route-permissions"
import { checkRateLimit } from "@/lib/rate-limit"
import { generateOneTimeToken } from "@/lib/one-time-token"
import {
  LOCATION_SHARE_LINK_ALIVE_LIMIT,
  buildLocationShareLinkUrl,
  locationShareLinkAliveWhere,
  locationShareLinkExpiresAt,
  locationShareLinkLocale,
  locationShareLinkTimezone,
  locationShareLinkTodayStartedAt,
} from "@/lib/mtm/location-share-link"
import { readLocationShareLinkPosition } from "@/lib/mtm/location-share-link-position"
import {
  LOCATION_SHARE_LINK_SELECT,
  locationShareLinkAccessFor,
  locationShareLinkDisabled,
  locationShareLinkLimitReached,
  locationShareLinkNotFound,
  locationShareLinkRateLimited,
  locationShareLinkReadDenied,
  locationShareLinkWriteDenied,
  presentLocationShareLink,
  type KeptLocationShareLink,
} from "@/lib/mtm/location-share-access"

// Asked for when the card's block is opened and after each change in it. A
// dispatcher going down the list opens about a card a second — the same
// allowance as the card's «device» block.
const READ_RATE_LIMIT = { maxRequests: 60, windowMs: 60_000 }
// Making and revoking share one allowance (the key is the same in ./[id]):
// a person makes a link now and then, a script makes hundreds.
const WRITE_RATE_LIMIT = { maxRequests: 30, windowMs: 60_000 }
// Links that no longer work, shown under the working ones so that «я же
// делал ссылку» has an answer: revoked, or its time ran out. Today's only —
// see locationShareLinkTodayStartedAt.
const PAST_LINKS_SHOWN = 5

/**
 * Who made each link, by name. One narrow read for the handful of people
 * behind one employee's links; a name that cannot be read is simply absent —
 * the list is not worth failing over it.
 */
async function locationShareLinkAuthorNames(orgId: string, links: readonly KeptLocationShareLink[]): Promise<Map<string, string>> {
  const ids = [...new Set(links.map((link) => link.createdBy).filter((id): id is string => Boolean(id)))]
  if (ids.length === 0) return new Map()
  try {
    const users = await prisma.user.findMany({ where: { organizationId: orgId, id: { in: ids } }, select: { id: true, name: true } })
    const names = new Map<string, string>()
    for (const user of users) {
      const name = typeof user.name === "string" ? user.name.trim() : ""
      if (name) names.set(user.id, name)
    }
    return names
  } catch (error) {
    console.warn("[MTM/locations/share-links GET] author names unavailable", error)
    return new Map()
  }
}

/**
 * Whether a link to this employee shows a point at this very moment — asked
 * of the same reads and the same rule as the public answer, so the card can
 * say «сейчас точка не показывается» exactly when the outsider is shown none
 * (off shift, on a break, a phone that has been silent).
 *
 * A courtesy to the manager: when it cannot be read the list is answered
 * without it, and the card says nothing rather than guess.
 */
async function locationShareLinkShowsNow(input: Parameters<typeof readLocationShareLinkPosition>[0]): Promise<boolean | null> {
  try {
    return (await readLocationShareLinkPosition(input)).position.state === "AVAILABLE"
  } catch (error) {
    console.warn("[MTM/locations/share-links GET] position unavailable", error)
    return null
  }
}

/**
 * GET /api/v1/mtm/locations/share-links?agentId=
 *
 * The links to one employee's position, for the «Ссылка на местоположение»
 * block of his card on the live map: the working ones first, then the last
 * few of today's that no longer work. Of each only what the card says — until
 * when, who made it, how many times it was opened. Never the link itself:
 * only its hash was ever kept, and that does not leave the table either.
 *
 * `access` tells the page what to offer: `enabled` is the organization's
 * switch (off — nothing can be made, and nothing works), `canWrite` is this
 * viewer. A link is made only when both are true; revoking needs `canWrite`
 * alone, so the list is answered while the switch is off too.
 *
 * `showsNow` — present only while the switch is on — says whether a link to
 * him shows a point right now (locationShareLinkShowsNow above). While the
 * switch is off no link shows anything, and `access.enabled` already says so.
 */
export const GET = withRouteFieldWebRlsAuth("read", async (req, auth) => {
  const orgId = auth.orgId
  const agentId = new URL(req.url).searchParams.get("agentId")?.trim() || ""
  try {
    const access = await locationShareLinkAccessFor(auth)
    if (access.kind === "none") return locationShareLinkReadDenied(access)
    if (!checkRateLimit(`mtm-location-share-links:${orgId}:${auth.userId}`, READ_RATE_LIMIT)) return locationShareLinkRateLimited()
    if (!agentId) return NextResponse.json({ error: "agentId is required" }, { status: 400 })
    // Somebody else's employee and one who does not exist get the same
    // answer, and for the first nothing is read at all.
    if (!isAgentInRouteScope(access.actor, agentId)) return locationShareLinkNotFound()
    const agent = await prisma.mtmAgent.findFirst({
      where: { id: agentId, organizationId: orgId, status: "ACTIVE" },
      select: { id: true },
    })
    if (!agent) return locationShareLinkNotFound()

    const settings = await getMtmSettings(orgId)
    const enabled = settings.locationShareLinksEnabled === true
    const now = new Date()
    const working = await prisma.mtmLocationShareLink.findMany({
      where: { organizationId: orgId, agentId, ...locationShareLinkAliveWhere(now) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      // The limit holds this to a handful; the margin costs nothing and
      // keeps a row beyond it — should one ever exist — revocable.
      take: LOCATION_SHARE_LINK_ALIVE_LIMIT * 4,
      select: LOCATION_SHARE_LINK_SELECT,
    })
    const past = await prisma.mtmLocationShareLink.findMany({
      where: {
        organizationId: orgId,
        agentId,
        createdAt: { gte: locationShareLinkTodayStartedAt(now, locationShareLinkTimezone(settings.timezone)) },
        OR: [{ revokedAt: { not: null } }, { expiresAt: { lte: now } }],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAST_LINKS_SHOWN,
      select: LOCATION_SHARE_LINK_SELECT,
    })
    const links = [...working, ...past]
    const authors = await locationShareLinkAuthorNames(orgId, links)
    const showsNow = enabled ? await locationShareLinkShowsNow({ organizationId: orgId, agentId, settings, now }) : null

    return NextResponse.json({
      success: true,
      data: {
        links: links.map((link) => presentLocationShareLink(link, now, (link.createdBy && authors.get(link.createdBy)) || null)),
        access: { enabled, canWrite: access.kind === "writer" },
        ...(showsNow === null ? {} : { showsNow }),
      },
    })
  } catch (e) {
    console.error("[MTM/locations/share-links GET]", e)
    return NextResponse.json({ error: "Failed to load location links", code: "MTM_LOCATION_SHARE_LINK_FAILED" }, { status: 500 })
  }
})

/**
 * POST /api/v1/mtm/locations/share-links
 *
 * Makes a link to one employee's position: `{ agentId, duration }`, where the
 * duration is one of the card's three buttons. An administrator or a manager
 * at a browser, for an employee in his scope, and only while the organization
 * has the links switched on.
 *
 * The answer is the only time the link exists in the clear: `data.url`. The
 * table keeps its SHA-256, so it cannot be shown again — not by the list, not
 * by anybody with the database. For the same reason a request sent twice makes
 * two links: an answer that was lost cannot be served again, and the limit on
 * working links per employee is what bounds the leftovers.
 *
 * `data.link.expiresAt` is the real moment: a link never lives past the
 * organization's midnight, so «на 4 часа» late in the evening is shorter.
 */
export const POST = withRouteFieldWebRlsAuth("write", async (req, auth) => {
  const orgId = auth.orgId
  try {
    // Who (403), then whether at all (403), then what (400), then whom (404).
    const access = await locationShareLinkAccessFor(auth)
    if (access.kind !== "writer") return locationShareLinkWriteDenied(access)
    if (!checkRateLimit(`mtm-location-share-links-write:${orgId}:${auth.userId}`, WRITE_RATE_LIMIT)) return locationShareLinkRateLimited()
    const settings = await getMtmSettings(orgId)
    if (settings.locationShareLinksEnabled !== true) return locationShareLinkDisabled()
    const parsed = parseBody(LocationShareLinkCreateSchema, await req.json().catch(() => null))
    if (!parsed.ok) return parsed.response
    const { agentId, duration } = parsed.data

    // Somebody else's employee and one who does not exist get the same
    // answer, and for the first nothing is read at all.
    if (!isAgentInRouteScope(access.actor, agentId)) return locationShareLinkNotFound()
    const agent = await prisma.mtmAgent.findFirst({
      where: { id: agentId, organizationId: orgId, status: "ACTIVE" },
      select: { id: true },
    })
    if (!agent) return locationShareLinkNotFound()

    const now = new Date()
    const { token, tokenHash } = generateOneTimeToken()
    // Counting his working links and making one more are one step, behind a
    // lock per employee held until the transaction ends: requests that arrive
    // together — two managers, a client retrying, a script — take turns, and
    // each counts what the one before it made. Without the lock every one of
    // them counted four and made a fifth. `$executeRaw`, not `$queryRaw`: the
    // function returns PostgreSQL `void`, which `$queryRaw` cannot read (P2010).
    const outcome: KeptLocationShareLink | "off" | "limit" = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-location-share-link:${orgId}:${agentId}`}, 0))`
      // The switch is asked once more here, and its row is held (FOR SHARE)
      // until this transaction ends. The look above was taken before the wait
      // for the employee's lock: a save that switched the links off in
      // between had ended every link there was and gone, and this request
      // then made one more that nobody ended — dead while off, and working
      // again the moment the switch came back on. The save writes this row
      // first and ends the links second (PUT /api/v1/mtm/settings), so with
      // the row held the two take turns: either this link is committed first
      // and the save's next statement ends it with the rest, or the save is
      // first and what is read here is «off». No row is the default — off.
      const kept = await tx.$queryRaw<Array<{ value: unknown }>>`
        SELECT "value"
        FROM "mtm_settings"
        WHERE "organizationId" = ${orgId}
          AND "key" = 'locationShareLinksEnabled'
        FOR SHARE
      `
      if (coerceMtmBooleanSetting(kept[0]?.value, MTM_SETTING_DEFAULTS.locationShareLinksEnabled) !== true) return "off"
      const working = await tx.mtmLocationShareLink.count({
        where: { organizationId: orgId, agentId, ...locationShareLinkAliveWhere(now) },
      })
      if (working >= LOCATION_SHARE_LINK_ALIVE_LIMIT) return "limit"
      const made: KeptLocationShareLink = await tx.mtmLocationShareLink.create({
        data: {
          organizationId: orgId,
          agentId,
          tokenHash,
          createdBy: auth.userId,
          // The same moment the expiry is counted from, not the database's own.
          createdAt: now,
          expiresAt: locationShareLinkExpiresAt(duration, now, locationShareLinkTimezone(settings.timezone)),
        },
        select: LOCATION_SHARE_LINK_SELECT,
      })
      return made
    })
    if (outcome === "off") return locationShareLinkDisabled()
    if (outcome === "limit") return locationShareLinkLimitReached()
    const link = outcome

    await writeMtmAudit({
      organizationId: orgId,
      // The employee the link shows: his managers find the row by him.
      agentId,
      action: "LOCATION_SHARE_LINK_CREATE",
      entity: "location_share_link",
      entityId: link.id,
      metadataKind: "location_share_link",
      // Which button and until when. Never the token, and never its hash.
      newData: { duration, expiresAt: link.expiresAt.toISOString() },
      req,
    }).catch((error) => console.warn("[MTM/locations/share-links POST] audit failed", error))

    // The recipient reads the page in the language of the manager who made
    // the link: his interface language, as the browser's cookie names it.
    const locale = locationShareLinkLocale(req.cookies.get("NEXT_LOCALE")?.value)
    const ownName = typeof auth.name === "string" ? auth.name.trim() : ""
    return NextResponse.json(
      {
        success: true,
        data: {
          link: presentLocationShareLink(link, now, ownName || null),
          url: buildLocationShareLinkUrl(token, locale),
        },
      },
      { status: 201 },
    )
  } catch (e) {
    console.error("[MTM/locations/share-links POST]", e)
    return NextResponse.json({ error: "Failed to make the location link", code: "MTM_LOCATION_SHARE_LINK_FAILED" }, { status: 500 })
  }
})
