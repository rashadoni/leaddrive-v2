import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { checkPermission, type Role } from "@/lib/permissions"
import { resolveMtmRouteActor, type MtmRouteActor } from "@/lib/mtm/route-permissions"
import { LOCATION_SHARE_LINK_ALIVE_LIMIT, isLocationShareLinkAlive } from "@/lib/mtm/location-share-link"

/**
 * Who sees and who makes «ссылки на местоположение» — one answer for the list,
 * for making a link and for revoking one (routes under
 * /api/v1/mtm/locations/share-links), and for the live map, which draws the
 * block on an employee's card only for somebody this file lets in.
 *
 * A link shows a named person's position to somebody outside the
 * organization, so this is narrower than the zones beside it:
 *
 *   - nobody — a field employee and a web user without an MTM card (the live
 *     map is the managers' screen), and anything that is not a person at a
 *     browser. An integration key gets nothing here, not even the list: who
 *     is being watched by an outsider is not a key's business, and a link is
 *     made by somebody the journal can name;
 *   - reader — a supervisor: he sees that a link to his employee exists, who
 *     made it and until when, and makes or revokes none;
 *   - writer — an administrator or a manager at a browser, for an employee in
 *     his scope. The routes ask the scope themselves, per employee
 *     (isAgentInRouteScope), with the actor handed back from here.
 *
 * Whether the organization has the links switched on at all
 * (`locationShareLinksEnabled`) is not asked here — the routes read it, since
 * revoking has to stay possible while it is off.
 *
 * Server only — it reads the database. The rules of a link itself are in
 * location-share-link.ts.
 */
export type LocationShareLinkAccess =
  | { kind: "none"; because: "not-a-person" | "not-a-manager" }
  | { kind: "reader"; because: "supervisor" | "web-role"; actor: MtmRouteActor }
  | { kind: "writer"; actor: MtmRouteActor }

/** The same answer for a caller whose MTM card has already been read (the live roster has it). */
export function locationShareLinkAccessOf(viewer: {
  principalType?: "session" | "api_key"
  role: Role
  actor: MtmRouteActor | null
}): LocationShareLinkAccess {
  // Compared to its exact value, never «not a key»: a caller whose provenance
  // is unknown gets nothing either.
  if (viewer.principalType !== "session") return { kind: "none", because: "not-a-person" }
  const { actor } = viewer
  if (!actor || actor.role === "AGENT") return { kind: "none", because: "not-a-manager" }
  if (actor.role !== "ADMIN" && actor.role !== "MANAGER") return { kind: "reader", because: "supervisor", actor }
  // What the wrapper asks of a write before the handler is entered. Asked
  // here as well so that the card does not offer a button — `canWrite` — to
  // somebody whose web role the wrapper would then refuse.
  if (!checkPermission(viewer.role, "mtm", "write")) return { kind: "reader", because: "web-role", actor }
  return { kind: "writer", actor }
}

export async function locationShareLinkAccessFor(auth: {
  orgId: string
  userId: string
  role: Role
  principalType?: "session" | "api_key"
}): Promise<LocationShareLinkAccess> {
  // Before the card is looked up: for a key no statement is run at all.
  if (auth.principalType !== "session") return { kind: "none", because: "not-a-person" }
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    // The web-only wrapper has already rejected mobile JWTs.
    agentId: null,
  })
  return locationShareLinkAccessOf({ principalType: auth.principalType, role: auth.role, actor })
}

/**
 * What the live map's contract says about the links to this viewer: nothing
 * (the block is not drawn) while the organization has them switched off or
 * the viewer is let in to nothing; otherwise whether he may make and revoke.
 */
export function locationShareLinkContract(enabled: boolean, access: LocationShareLinkAccess): { canWrite: boolean } | null {
  if (enabled !== true || access.kind === "none") return null
  return { canWrite: access.kind === "writer" }
}

/** 403 for a caller who is let in to nothing. */
export function locationShareLinkReadDenied(access: Extract<LocationShareLinkAccess, { kind: "none" }>): Response {
  if (access.because === "not-a-person") {
    return NextResponse.json(
      { error: "Location links are for a person signed in at a browser", code: "MTM_LOCATION_SHARE_LINK_SESSION_REQUIRED" },
      { status: 403 },
    )
  }
  return NextResponse.json({ error: "Manager access required", code: "MTM_LOCATION_SHARE_LINK_MANAGER_REQUIRED" }, { status: 403 })
}

/** 403 for a caller who may not make or revoke a link. */
export function locationShareLinkWriteDenied(access: Exclude<LocationShareLinkAccess, { kind: "writer" }>): Response {
  if (access.kind === "none") return locationShareLinkReadDenied(access)
  return NextResponse.json(
    { error: "Location links are read-only for you", code: "MTM_LOCATION_SHARE_LINK_READ_ONLY" },
    { status: 403 },
  )
}

/** 403 while the organization has the links switched off (MTM settings, «Карта агентов»). */
export function locationShareLinkDisabled(): Response {
  return NextResponse.json(
    {
      error: "The organization has location links switched off",
      code: "MTM_LOCATION_SHARE_LINK_DISABLED",
      setting: "locationShareLinksEnabled",
    },
    { status: 403 },
  )
}

/**
 * One 404 for everything that is not there for this caller: an employee who
 * does not exist, one outside his scope, a link of another organization, a
 * link already revoked. The same bytes, so the answer tells none of them apart.
 */
export function locationShareLinkNotFound(): Response {
  return NextResponse.json({ error: "Not found", code: "MTM_LOCATION_SHARE_LINK_NOT_FOUND" }, { status: 404 })
}

export function locationShareLinkRateLimited(): Response {
  return NextResponse.json(
    { error: "Too many requests. Try again in a minute.", code: "MTM_LOCATION_SHARE_LINK_RATE_LIMITED", retryAfterSeconds: 60 },
    { status: 429, headers: { "Retry-After": "60" } },
  )
}

export function locationShareLinkLimitReached(): Response {
  return NextResponse.json(
    {
      error: `An employee can have at most ${LOCATION_SHARE_LINK_ALIVE_LIMIT} working location links at once`,
      code: "MTM_LOCATION_SHARE_LINK_LIMIT_REACHED",
      limit: LOCATION_SHARE_LINK_ALIVE_LIMIT,
    },
    { status: 409 },
  )
}

/**
 * What is read of a link for the managers. Never `tokenHash`: nothing that
 * leads back to the link leaves the table once the link has been handed over.
 */
export const LOCATION_SHARE_LINK_SELECT = {
  id: true,
  createdBy: true,
  createdAt: true,
  expiresAt: true,
  revokedAt: true,
  viewCount: true,
  lastViewedAt: true,
} as const

/** A row as LOCATION_SHARE_LINK_SELECT reads it. */
export interface KeptLocationShareLink {
  id: string
  createdBy: string | null
  createdAt: Date
  expiresAt: Date
  revokedAt: Date | null
  viewCount: number
  lastViewedAt: Date | null
}

/**
 * A link as the card shows it, written out field by field: until when, who
 * made it, how many times it was opened. `alive` is the server's own verdict
 * at the moment of the answer, so the page does not judge by its own clock
 * which links still get a «Отозвать» button.
 */
export function presentLocationShareLink(link: KeptLocationShareLink, now: Date, createdByName: string | null) {
  return {
    id: link.id,
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    revokedAt: link.revokedAt,
    viewCount: link.viewCount,
    lastViewedAt: link.lastViewedAt,
    createdByName,
    alive: isLocationShareLinkAlive(link, now),
  }
}
