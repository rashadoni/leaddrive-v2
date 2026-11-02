import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { hashOneTimeToken } from "@/lib/one-time-token"
import { checkRateLimit } from "@/lib/rate-limit"
import { clientIp } from "@/lib/request-ip"
import { getMtmSettings } from "@/lib/mtm-settings"
import { isTenantCapabilityEnabled } from "@/lib/tenant-capabilities"
import { isLocationShareLinkAlive, isLocationShareLinkToken, locationShareLinkAliveWhere } from "@/lib/mtm/location-share-link"
import { readLocationShareLinkPosition } from "@/lib/mtm/location-share-link-position"

// The answer is a person's position at this moment: never a stored one.
export const dynamic = "force-dynamic"

// An open page asks twice a minute. The allowance is per address and per
// link, so a few people behind one office address can watch the same link,
// and a script hammering one link stops being answered.
const VIEW_RATE_LIMIT = { maxRequests: 30, windowMs: 60_000 }
const RETRY_AFTER_SECONDS = 60
// «Последний раз в 14:05» moves at most once a minute per link: an open page
// asks twice a minute and must not write on every request it makes.
const VIEW_STAMP_INTERVAL_MS = 60_000
// «Открыта 3 раза» counts sittings, not minutes watched: a view is a new
// opening only when nobody has asked about the link for five minutes — longer
// than an open page ever stays silent (it asks every thirty seconds, and waits
// a minute when told to slow down). A page left open for an hour is one.
const VIEW_SITTING_GAP_MS = 5 * 60_000

// On every answer, also the refusals: a position must not be kept by a
// browser or anything between it and us, nor found by a search engine.
const ANSWER_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, private",
  Pragma: "no-cache",
  "X-Robots-Tag": "noindex, nofollow",
}

/**
 * The one answer for a link that does not work — whatever the reason: not a
 * link at all, never made, revoked, out of time, switched off by the
 * organization, or its organization or employee no longer active. The same
 * bytes each time, so the answer tells a stranger none of these apart.
 */
function gone() {
  return NextResponse.json({ success: false, state: "GONE" }, { status: 404, headers: ANSWER_HEADERS })
}

function slowDown() {
  return NextResponse.json(
    { success: false, state: "RATE_LIMITED", retryAfterSeconds: RETRY_AFTER_SECONDS },
    { status: 429, headers: { ...ANSWER_HEADERS, "Retry-After": String(RETRY_AFTER_SECONDS) } },
  )
}

/**
 * What the log may say of a failure: its kind. Never its message — Prisma
 * words a failed statement together with its arguments, and the argument
 * here is the hash of somebody's link.
 */
function failureKind(error: unknown): string {
  if (!(error instanceof Error)) return typeof error
  const name = /^[A-Za-z0-9_]{1,64}$/.test(error.name) ? error.name : "Error"
  const code = (error as Error & { code?: unknown }).code
  return typeof code === "string" && /^[A-Z0-9_]{1,16}$/.test(code) ? `${name} ${code}` : name
}

/**
 * Notes the view on the link's own row — so that the manager's card can say
 * how many times the link was opened, and when it was last looked at.
 *
 * One conditional statement, at most once a minute per link. Whether this
 * view opens a new sitting is decided from the row as it was read a moment
 * ago, and the table confirms it: the statement finds the row only while that
 * is still true. Nothing here is the visitor's to say — a request cannot ask
 * not to be counted.
 *
 * Called inside the organization's scope. Never fails the answer: whoever
 * opened the link came for the position, not for our counter.
 */
async function stampLocationShareLinkView(
  link: { id: string; organizationId: string; lastViewedAt: Date | null },
  now: Date,
): Promise<void> {
  const notSince = new Date(now.getTime() - VIEW_STAMP_INTERVAL_MS)
  // The row as it was just read already says this minute is noted: most of
  // an open page's requests stop here, without a statement.
  if (link.lastViewedAt && link.lastViewedAt.getTime() > notSince.getTime()) return
  const sittingBefore = new Date(now.getTime() - VIEW_SITTING_GAP_MS)
  const opening = !link.lastViewedAt || link.lastViewedAt.getTime() <= sittingBefore.getTime()
  try {
    await prisma.mtmLocationShareLink.updateMany({
      where: {
        id: link.id,
        organizationId: link.organizationId,
        // Revoked a moment ago — then this was not a view of a working link.
        ...locationShareLinkAliveWhere(now),
        // Two people opening the link at the same instant both get this far;
        // the table lets one of them count, and the other finds no row.
        OR: opening ? [{ lastViewedAt: null }, { lastViewedAt: { lte: sittingBefore } }] : [{ lastViewedAt: { lte: notSince } }],
      },
      data: opening ? { viewCount: { increment: 1 }, lastViewedAt: now } : { lastViewedAt: now },
    })
  } catch (error) {
    console.warn("[public/location-share GET] view not counted:", failureKind(error))
  }
}

/**
 * GET /api/v1/public/location-share/[token]
 *
 * What somebody with a «ссылка на местоположение» and no account is told:
 * the employee's name, the organization's name, and — only while he is on
 * shift and his phone has just reported — the one point where he is now.
 * The page at /share/location/[token] asks this twice a minute.
 *
 * Three answers, each written out field by field (a row is never handed over
 * as it was read):
 *   - AVAILABLE — the point, when it was recorded, until when the link works;
 *   - UNAVAILABLE — the link works and there is nothing to show now. No
 *     reason is given and no coordinate key is present: «на перерыве» and
 *     «смена не начата» are facts about a person the link was not made to tell;
 *   - GONE (404) — see gone() above. Any failure of ours answers GONE too.
 *
 * The token is the only thing that names the organization, so the link is
 * looked up once outside any organization (the table's policy lets the
 * bypass read it), by the SHA-256 the table keeps. Everything after that —
 * the organization's switch, the employee, his shift, his position, the view
 * counter — runs inside that organization's scope and nowhere else.
 *
 * Why not under /api/v1/mtm/: the proxy answers 403 there to anybody signed
 * in to an organization without the field product, and the recipient of a
 * link may well be signed in to something.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    // Not a link of ours: answered without a hash and without the database.
    if (!isLocationShareLinkToken(token)) return gone()
    const tokenHash = hashOneTimeToken(token)
    // The address as nginx saw it, never a header the caller can write; of
    // the link only a piece of its hash, so the token is in no limiter key
    // and in none of this route's own log lines.
    const ip = clientIp(req)
    if (!checkRateLimit(`mtm-location-share-link-view:${ip}:${tokenHash.slice(0, 16)}`, VIEW_RATE_LIMIT)) return slowDown()

    const now = new Date()
    const link = await runWithRlsBypass(() => prisma.mtmLocationShareLink.findUnique({
      where: { tokenHash },
      select: { id: true, organizationId: true, agentId: true, expiresAt: true, revokedAt: true, lastViewedAt: true },
    }))
    if (!link || !isLocationShareLinkAlive(link, now)) return gone()

    const organizationId = link.organizationId
    return await runWithTenant(organizationId, async () => {
      // The organization's switch is asked on every view: switched off, every
      // link is dead at once. The save that switches it off also revokes
      // them all (PUT /api/v1/mtm/settings), so switching it back on revives
      // none — and still the question is asked here every time: whether a
      // link opens must not lean on rows having been written.
      const settings = await getMtmSettings(organizationId)
      if (settings.locationShareLinksEnabled !== true) return gone()

      // The employee together with the organization he belongs to: a link
      // does not outlive an employee who was deactivated, an organization
      // that was closed, or the field product being taken away from it —
      // the same entitlement the managers' own map is behind.
      const agent = await prisma.mtmAgent.findFirst({
        where: { id: link.agentId, organizationId, status: "ACTIVE", fieldDeletedAt: null },
        select: {
          name: true,
          organization: { select: { name: true, isActive: true, plan: true, addons: true, features: true, modules: true } },
        },
      })
      if (!agent || agent.organization.isActive !== true) return gone()
      if (!isTenantCapabilityEnabled("route-field", agent.organization)) return gone()

      // Whether there is a point to show, and which: the same reads and the
      // same rule the managers' list goes by when it tells a manager that a
      // link shows nothing right now (location-share-link-position.ts).
      const { position, timezone } = await readLocationShareLinkPosition({ organizationId, agentId: link.agentId, settings, now })

      await stampLocationShareLinkView(link, now)

      if (position.state !== "AVAILABLE") {
        return NextResponse.json(
          {
            success: true,
            state: "UNAVAILABLE",
            data: {
              name: agent.name,
              organizationName: agent.organization.name,
              expiresAt: link.expiresAt,
              generatedAt: now,
              timezone,
            },
          },
          { headers: ANSWER_HEADERS },
        )
      }
      return NextResponse.json(
        {
          success: true,
          state: "AVAILABLE",
          data: {
            name: agent.name,
            organizationName: agent.organization.name,
            latitude: position.latitude,
            longitude: position.longitude,
            recordedAt: position.recordedAt,
            expiresAt: link.expiresAt,
            // The page counts «N минут назад» from this moment, not from the
            // clock of the phone it is opened on.
            generatedAt: now,
            timezone,
          },
        },
        { headers: ANSWER_HEADERS },
      )
    })
  } catch (error) {
    console.error("[public/location-share GET] failed:", failureKind(error))
    return gone()
  }
}
