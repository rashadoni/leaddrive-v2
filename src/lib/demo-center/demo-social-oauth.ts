import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { decryptToken, encryptToken, hmacToken } from "@/lib/secure-token"
import { grantedPageIds } from "@/lib/social/meta-granted-assets"
import { claimedMetaPageIds } from "@/lib/social/meta-page-claims"
import { subscribePageToMessages } from "@/lib/social/meta-subscribe"
import { unsubscribePageFromApp } from "@/lib/social/meta-unbind"
import { getPinnedMetaApp, type PinnedMetaApp } from "@/lib/social/tenant-meta-app"
import { DEMO_SOCIAL_CONSENT_VERSION } from "./demo-social-consent"
import {
  demoSocialCode,
  demoSocialReleaseReason,
  demoSocialTokenPurpose,
  type DemoSocialReleaseReason,
} from "./demo-social-connection"
import { DEMO_SOCIAL_RELEASE_LEASE_MS } from "./demo-social-release"
import { demoWhatsAppThreadEnds } from "./demo-whatsapp-welcome"
import { inDemoSalesOrganization } from "./sales-org"
import { isSessionExpired, type DemoGrantTimeState } from "./session"

/**
 * Connecting a prospect's own Facebook Page to the demo (docs/DEMO_CENTER.md,
 * «Live social connections»): the Meta dialog, the way back, and the one
 * Page that gets bound. The release side (demo-social-release.ts) shipped
 * first; everything here leaves a row it can undo.
 *
 * Two switches, both required:
 *   - the server names LeadDrive Inc.'s staged Facebook app row in
 *     DEMO_SOCIAL_META_APP_CONFIG_ID, read through the one door into the
 *     sales organisation (sales-org.ts) by `getPinnedMetaApp` — no env app,
 *     no other row, ever;
 *   - the admin ticked «Facebook səhifəsi» on this grant (`liveSocialEnabled`).
 *
 * The dialog is the product's own for that pinned app
 * (src/app/api/v1/social/oauth/facebook/start/route.ts): a Facebook Login for
 * Business configuration (`config_id`) when the row carries one, otherwise
 * exactly the four approved permissions. It comes back to the product's
 * redirect URI and callback route, which hands a demo state (`ldd.…`) to
 * `completeDemoSocialConnect` before anything else — so nothing changes in
 * the Meta dashboard, and the product's own path never sees a demo state.
 *
 * The state names the connection row and is signed; the browser that started
 * holds a random nonce in an httpOnly cookie whose hash is on the row. The raw
 * demo token is in neither. One use, fifteen minutes.
 *
 * Record before acting at Meta: the user token is stored (encrypted) right
 * after the code exchange, and the Page token before the Page is subscribed.
 * While the subscribe is on its way the bind holds the release's lease, so
 * the release's unsubscribe can only come after it.
 * Only ever one Page per connection; a Page some organisation relies on — by
 * its own id or its linked Instagram account's — is refused, as is a Page
 * another live demo holds.
 */

export const DEMO_SOCIAL_STATE_PREFIX = "ldd."
export const DEMO_SOCIAL_OAUTH_COOKIE = "ld_demo_fb_oauth"
/** The cookie goes back only to the callback. */
export const DEMO_SOCIAL_OAUTH_COOKIE_PATH = "/api/v1/social/oauth/facebook/callback"
export const DEMO_SOCIAL_OAUTH_TTL_MS = 15 * 60_000
/** Connections holding anything at Meta, across every demo: a ceiling, not a target. */
export const DEMO_SOCIAL_MAX_OPEN = 20
/** The permissions the app has approved for Messenger, and nothing else (when no configuration is set). */
export const DEMO_SOCIAL_SCOPES = ["public_profile", "pages_show_list", "pages_manage_metadata", "pages_messaging"] as const
/** How many Pages one grant can choose between. */
const MAX_PAGES = 25

const META_ID = /^[0-9]{1,32}$/
const CONNECTION_ID = /^[a-z0-9]{10,40}$/
const STATE_PURPOSE = "demo-social-oauth-state"
const PAGE_FIELDS_WITH_INSTAGRAM = "id,name,access_token,instagram_business_account"
const PAGE_FIELDS = "id,name,access_token"

export interface DemoSocialGrant extends DemoGrantTimeState {
  id: string
  liveSocialEnabled: boolean
  scenarioId: string | null
}

/** The grant may use the feature at all: its switch, a guided story, a live session. */
export function demoSocialGrantAllowed(grant: DemoSocialGrant, now: Date = new Date()): boolean {
  return grant.status === "ACTIVE"
    && grant.liveSocialEnabled
    && Boolean(grant.scenarioId)
    && Boolean(grant.sessionStartedAt)
    && !isSessionExpired(grant, now)
}

/** The env switch alone, for the cheap paths (the webhook) that must not query anything when it is off. */
export function demoSocialConfiguredId(): string | null {
  return process.env.DEMO_SOCIAL_META_APP_CONFIG_ID?.trim() || null
}

export interface DemoSocialApp {
  app: PinnedMetaApp
  redirectUri: string
}

/**
 * The demo's Meta app: LeadDrive Inc.'s staged Facebook app row the server
 * names, read inside the sales organisation and nowhere else. Null — the
 * feature is off — when the env does not name one, the row does not resolve,
 * or the product's redirect URI is not configured.
 */
export async function demoSocialMetaApp(): Promise<DemoSocialApp | null> {
  const configId = demoSocialConfiguredId()
  const redirectUri = process.env.FACEBOOK_REDIRECT_URI?.trim()
  if (!configId || !redirectUri) return null
  const entered = await inDemoSalesOrganization((organizationId) => getPinnedMetaApp(organizationId, configId, "facebook"))
  const app = entered?.value ?? null
  return app ? { app, redirectUri } : null
}

// --- The signed state --------------------------------------------------------

function base64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url")
}

/** `ldd.<payload>.<hmac>`: the connection row and the moment it was issued. A product state is base64url and never holds a dot. */
export function signDemoSocialState(connectionId: string, issuedAt: Date): string {
  const payload = base64url(JSON.stringify({ c: connectionId, t: issuedAt.getTime() }))
  return `${DEMO_SOCIAL_STATE_PREFIX}${payload}.${hmacToken(payload, STATE_PURPOSE)}`
}

export function isDemoSocialOAuthState(state: string | null | undefined): state is string {
  return typeof state === "string" && state.startsWith(DEMO_SOCIAL_STATE_PREFIX)
}

export type DemoSocialStateCheck = { ok: true; connectionId: string } | { ok: false; reason: "invalid" | "expired" }

export function readDemoSocialState(state: string, now: Date = new Date()): DemoSocialStateCheck {
  if (!isDemoSocialOAuthState(state) || state.length > 1_024) return { ok: false, reason: "invalid" }
  const parts = state.slice(DEMO_SOCIAL_STATE_PREFIX.length).split(".")
  if (parts.length !== 2) return { ok: false, reason: "invalid" }
  const [payload, signature] = parts
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(payload) || !/^[0-9a-f]{64}$/.test(signature)) return { ok: false, reason: "invalid" }
  const expected = Buffer.from(hmacToken(payload, STATE_PURPOSE), "hex")
  const given = Buffer.from(signature, "hex")
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "invalid" }
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
  } catch {
    return { ok: false, reason: "invalid" }
  }
  const record = isRecord(parsed) ? parsed : {}
  const connectionId = typeof record.c === "string" && CONNECTION_ID.test(record.c) ? record.c : null
  const issuedAt = typeof record.t === "number" && Number.isFinite(record.t) ? record.t : null
  if (!connectionId || issuedAt === null) return { ok: false, reason: "invalid" }
  const age = now.getTime() - issuedAt
  if (age > DEMO_SOCIAL_OAUTH_TTL_MS || age < -60_000) return { ok: false, reason: "expired" }
  return { ok: true, connectionId }
}

export function demoSocialNonceHash(nonce: string): string {
  return createHash("sha256").update(nonce).digest("hex")
}

function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex")
  const right = Buffer.from(b, "hex")
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right)
}

/** The Meta dialog for the demo's app: the product's own shape for a pinned app. */
export function demoSocialDialogUrl(target: DemoSocialApp, state: string): string {
  const url = new URL("https://www.facebook.com/v21.0/dialog/oauth")
  url.searchParams.set("client_id", target.app.appId)
  url.searchParams.set("redirect_uri", target.redirectUri)
  url.searchParams.set("state", state)
  url.searchParams.set("response_type", "code")
  // Facebook Login for Business: the permissions live in the configuration,
  // and a `scope` beside it is refused (start/route.ts says why).
  if (target.app.loginConfigId) url.searchParams.set("config_id", target.app.loginConfigId)
  else url.searchParams.set("scope", DEMO_SOCIAL_SCOPES.join(","))
  return url.toString()
}

// --- Rows ------------------------------------------------------------------

const GRANT_TIME_SELECT = {
  status: true,
  linkExpiresAt: true,
  verificationExpiresAt: true,
  sessionStartedAt: true,
  sessionLastSeenAt: true,
  sessionExpiresAt: true,
  inactivityMinutes: true,
} as const

export const DEMO_SOCIAL_ROW_SELECT = {
  id: true,
  grantId: true,
  appConfigId: true,
  code: true,
  oauthStateHash: true,
  userTokenCipher: true,
  pendingPages: true,
  pageId: true,
  pageName: true,
  provenSenderId: true,
  connectedAt: true,
  provenAt: true,
  aiReplies: true,
  expiresAt: true,
  createdAt: true,
  releaseReason: true,
  releaseRequestedAt: true,
  scrubbedAt: true,
  grant: { select: { ...GRANT_TIME_SELECT, id: true, liveSocialEnabled: true, scenarioId: true } },
} satisfies Prisma.DemoSocialConnectionSelect

export type DemoSocialRow = Prisma.DemoSocialConnectionGetPayload<{ select: typeof DEMO_SOCIAL_ROW_SELECT }>

/** A Page as Meta lists it: never stored with its token but encrypted, never shown but by name. */
export interface DemoSocialPendingPage {
  id: string
  name: string
}

export function pendingPagesOf(value: unknown): DemoSocialPendingPage[] | null {
  if (!Array.isArray(value)) return null
  return value.flatMap((entry) =>
    isRecord(entry) && typeof entry.id === "string" && META_ID.test(entry.id) && typeof entry.name === "string"
      ? [{ id: entry.id, name: entry.name }]
      : [],
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function isUniqueViolation(error: unknown): boolean {
  return isRecord(error) && error.code === "P2002"
}

/** Ask for the release now; the cron unbinds within five minutes, and every use stops at once. */
export async function requestDemoSocialRelease(
  where: { connectionId: string } | { grantId: string },
  reason: DemoSocialReleaseReason,
  now: Date = new Date(),
): Promise<number> {
  const target = "connectionId" in where ? { id: where.connectionId } : { grantId: where.grantId }
  const updated = await runWithRlsBypass(() =>
    prisma.demoSocialConnection.updateMany({
      where: { ...target, scrubbedAt: null, releaseRequestedAt: null },
      data: { releaseRequestedAt: now, releaseReason: reason },
    }),
  )
  return updated.count
}

// --- Start -----------------------------------------------------------------

export type StartDemoSocialResult =
  | { ok: true; url: string; nonce: string }
  | { ok: false; code: "not_enabled" | "busy" | "releasing" | "already_connected" | "in_progress" }

/**
 * «Facebook ilə qoşun»: the grant's connection row (made now, or the one an
 * unfinished attempt left), a fresh nonce for this browser, and the dialog.
 * The ceiling on open connections is decided one at a time for every demo.
 */
export async function startDemoSocialConnect(grant: DemoSocialGrant, now: Date = new Date()): Promise<StartDemoSocialResult> {
  if (!demoSocialGrantAllowed(grant, now)) return { ok: false, code: "not_enabled" }
  const target = await demoSocialMetaApp()
  if (!target) return { ok: false, code: "not_enabled" }
  const nonce = randomBytes(32).toString("base64url")
  const stateHash = demoSocialNonceHash(nonce)

  const outcome = await runWithRlsBypass(() =>
    prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"demo-social-connect"}))`
      const existing = await tx.demoSocialConnection.findFirst({
        where: { grantId: grant.id, platform: "facebook", scrubbedAt: null },
        select: DEMO_SOCIAL_ROW_SELECT,
      })
      if (existing) {
        if (demoSocialReleaseReason(existing, now)) return { code: "releasing" as const }
        if (existing.connectedAt) return { code: "already_connected" as const }
        // A Page is being bound right now, or its binding failed: the release undoes it first.
        if (existing.pageId) return { code: "in_progress" as const }
        // A new attempt on the same row: its thirty minutes and its day start
        // now, and nothing of the attempt before it is kept — no Page list, no
        // user token, no Meta user.
        await tx.demoSocialConnection.update({
          where: { id: existing.id },
          data: {
            oauthStateHash: stateHash,
            pendingPages: Prisma.DbNull,
            appConfigId: target.app.configId,
            userTokenCipher: null,
            metaUserId: null,
            createdAt: now,
            expiresAt: demoWhatsAppThreadEnds(now),
          },
        })
        return { id: existing.id }
      }
      const open = await tx.demoSocialConnection.count({ where: { scrubbedAt: null } })
      if (open >= DEMO_SOCIAL_MAX_OPEN) return { code: "busy" as const }
      const created = await tx.demoSocialConnection.create({
        data: {
          grantId: grant.id,
          platform: "facebook",
          appConfigId: target.app.configId,
          code: demoSocialCode(grant.id),
          oauthStateHash: stateHash,
          createdAt: now,
          expiresAt: demoWhatsAppThreadEnds(now),
        },
        select: { id: true },
      })
      return { id: created.id }
    }),
  )
  if ("code" in outcome) return { ok: false, code: outcome.code }
  return { ok: true, url: demoSocialDialogUrl(target, signDemoSocialState(outcome.id, now)), nonce }
}

// --- Meta ------------------------------------------------------------------

function graphBase(): string {
  return (process.env.META_GRAPH_BASE || "https://graph.facebook.com/v21.0").replace(/\/+$/, "")
}

/** A read with the person's or the Page's token as a Bearer header; ten seconds at most; Meta's text never kept. */
async function graphGet(path: string, token: string): Promise<{ ok: boolean; body: unknown }> {
  try {
    const response = await fetch(`${graphBase()}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    })
    return { ok: response.ok, body: await response.json().catch(() => null) }
  } catch {
    return { ok: false, body: null }
  }
}

/**
 * The code exchange at `oauth/access_token`, as an OAuth token request is
 * made: a POST whose form body carries the app's credentials and the code (or
 * the short token) — so none of them is ever in an address. The answer's token
 * is the only thing read from it.
 */
async function tokenRequest(params: URLSearchParams): Promise<string | null> {
  try {
    const response = await fetch(`${graphBase()}/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return null
    const body = await response.json().catch(() => null)
    return isRecord(body) && typeof body.access_token === "string" && body.access_token ? body.access_token : null
  } catch {
    return null
  }
}

async function longLivedUserToken(target: DemoSocialApp, code: string): Promise<string | null> {
  const short = await tokenRequest(new URLSearchParams({
    client_id: target.app.appId,
    client_secret: target.app.appSecret,
    redirect_uri: target.redirectUri,
    code,
  }))
  if (!short) return null
  // Page tokens minted from a long-lived user token do not expire within the
  // day; from a short one they die after an hour — and with them the replies
  // and the release's unsubscribe.
  return tokenRequest(new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: target.app.appId,
    client_secret: target.app.appSecret,
    fb_exchange_token: short,
  }))
}

interface MetaPage {
  id: string
  name: string
  token: string
  instagramId: string | null
}

function toPage(raw: unknown): MetaPage | null {
  if (!isRecord(raw)) return null
  const id = typeof raw.id === "string" && META_ID.test(raw.id) ? raw.id : null
  const token = typeof raw.access_token === "string" && raw.access_token.length > 0 && raw.access_token.length < 4_096 ? raw.access_token : null
  if (!id || !token) return null
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 120) : "Facebook səhifəsi"
  const instagram = isRecord(raw.instagram_business_account) ? raw.instagram_business_account.id : null
  return { id, name, token, instagramId: typeof instagram === "string" && META_ID.test(instagram) ? instagram : null }
}

/**
 * The linked Instagram account is asked for and never required: an app
 * without an Instagram permission may be refused the field, and then the same
 * read goes again without it — the connect never fails for want of it.
 */
async function readWithInstagramFallback(path: (fields: string) => string, token: string): Promise<{ ok: boolean; body: unknown }> {
  const withInstagram = await graphGet(path(PAGE_FIELDS_WITH_INSTAGRAM), token)
  if (withInstagram.ok) return withInstagram
  return graphGet(path(PAGE_FIELDS), token)
}

async function fetchPage(pageId: string, userToken: string): Promise<MetaPage | null> {
  if (!META_ID.test(pageId)) return null
  const read = await readWithInstagramFallback((fields) => `/${pageId}?fields=${fields}`, userToken)
  return read.ok ? toPage(read.body) : null
}

/**
 * The Pages this login granted. `/me/accounts` first; when it is empty — a
 * Page reached through a business portfolio under Facebook Login for Business
 * — the granted Page ids from `debug_token`, each read by id, exactly as the
 * product's callback does (src/lib/social/meta-granted-assets.ts).
 */
async function grantedPages(target: DemoSocialApp, userToken: string): Promise<MetaPage[] | null> {
  const accounts = await readWithInstagramFallback((fields) => `/me/accounts?fields=${fields}&limit=100`, userToken)
  if (!accounts.ok) return null
  const listed = (isRecord(accounts.body) && Array.isArray(accounts.body.data) ? accounts.body.data : [])
    .map(toPage)
    .filter((page): page is MetaPage => page !== null)
  if (listed.length) return listed.slice(0, MAX_PAGES)
  const granted = await grantedPageIds(graphBase(), target.app.appId, target.app.appSecret, userToken)
  if (granted.error) return null
  const pages: MetaPage[] = []
  for (const id of granted.pageIds.slice(0, MAX_PAGES)) {
    const page = await fetchPage(id, userToken)
    if (page) pages.push(page)
  }
  return pages
}

async function metaUserId(userToken: string): Promise<string | null> {
  const me = await graphGet("/me?fields=id", userToken)
  const id = me.ok && isRecord(me.body) ? me.body.id : null
  return typeof id === "string" && META_ID.test(id) ? id : null
}

/**
 * Pages no organisation relies on — neither by the Page's id nor by its linked
 * Instagram account's — and no other live demo holds.
 */
async function connectablePages(pages: readonly MetaPage[], connectionId: string): Promise<MetaPage[]> {
  if (!pages.length) return []
  const ids = pages.flatMap((page) => (page.instagramId ? [page.id, page.instagramId] : [page.id]))
  const claimed = new Set(await claimedMetaPageIds(ids))
  const held = await runWithRlsBypass(() =>
    prisma.demoSocialConnection.findMany({
      where: { platform: "facebook", scrubbedAt: null, pageId: { in: pages.map((page) => page.id) }, id: { not: connectionId } },
      select: { pageId: true },
    }),
  )
  const busy = new Set(held.map((row: { pageId: string | null }) => row.pageId))
  return pages.filter((page) => !claimed.has(page.id) && !(page.instagramId && claimed.has(page.instagramId)) && !busy.has(page.id))
}

// --- Binding one Page ------------------------------------------------------

async function markRefused(connectionId: string): Promise<void> {
  await runWithRlsBypass(() =>
    prisma.demoSocialConnection.updateMany({
      where: { id: connectionId, scrubbedAt: null, connectedAt: null, pageId: null },
      data: { pendingPages: [] },
    }),
  )
}

type BindResult = "connected" | "refused" | "failed"

/**
 * The Page token is stored before the subscription is asked for, so a crash
 * between the two leaves a row the release can undo. A subscription Meta did
 * not confirm asks for the release at once: we may be subscribed after all.
 *
 * The same write takes the release's lease (DEMO_SOCIAL_RELEASE_LEASE_MS, far
 * longer than the subscribe's ten seconds), and every way out gives it back:
 * a release that comes due while the subscribe is on its way finds the lease
 * taken and tries again on its next run, so its unsubscribe always comes
 * after our subscribe. Should the connection end anyway before the bind
 * finishes — a lease that ran out — the bind unsubscribes the Page itself,
 * with the token it still holds, unless someone else relies on that Page.
 */
async function bindPage(row: { id: string; grantId: string | null }, page: MetaPage, now: Date): Promise<BindResult> {
  const leasedAt = new Date()
  const lease = new Date(leasedAt.getTime() + DEMO_SOCIAL_RELEASE_LEASE_MS)
  let recorded: number
  try {
    const updated = await runWithRlsBypass(() =>
      prisma.demoSocialConnection.updateMany({
        where: {
          id: row.id,
          scrubbedAt: null,
          releaseRequestedAt: null,
          connectedAt: null,
          pageId: null,
          OR: [{ releaseLeaseUntil: null }, { releaseLeaseUntil: { lte: leasedAt } }],
        },
        data: {
          pageId: page.id,
          pageName: page.name,
          linkedInstagramId: page.instagramId,
          pageTokenCipher: encryptToken(page.token, demoSocialTokenPurpose(row.id, "page")),
          pendingPages: Prisma.DbNull,
          releaseLeaseUntil: lease,
        },
      }),
    )
    recorded = updated.count
  } catch (error) {
    // Another live demo bound this Page a moment ago (the partial unique index).
    if (isUniqueViolation(error)) {
      await markRefused(row.id)
      return "refused"
    }
    throw error
  }
  if (!recorded) return "failed"

  // Our lease back, and only ours: a release that took over a lease which ran out keeps its own.
  const giveLeaseBack = () =>
    runWithRlsBypass(() =>
      prisma.demoSocialConnection.updateMany({ where: { id: row.id, releaseLeaseUntil: lease }, data: { releaseLeaseUntil: null } }),
    )

  let connected = false
  let keepLease = false
  try {
    const subscribed = await subscribePageToMessages(page.id, page.token, { fields: "messages" })
    if (!subscribed.success) {
      // Not confirmed is not «not done»: a POST that timed out on our side
      // may still take effect at Meta a moment later. The lease is kept until
      // it runs out, so the release's DELETE goes out at least two minutes
      // after our POST and does not land before it.
      keepLease = true
      await requestDemoSocialRelease({ connectionId: row.id }, "connect_abandoned", now)
      return "failed"
    }
    connected = await runWithRlsBypass(() =>
      prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const done = await tx.demoSocialConnection.updateMany({
          where: { id: row.id, scrubbedAt: null, releaseRequestedAt: null, connectedAt: null, pageId: page.id },
          data: { subscribedAt: now, connectedAt: now, releaseLeaseUntil: null },
        })
        if (!done.count) return false
        if (row.grantId) {
          await tx.demoAccessEvent.create({
            data: { grantId: row.grantId, eventType: "SOCIAL_CONNECTED", metadata: { platform: "facebook", consentVersion: DEMO_SOCIAL_CONSENT_VERSION } },
          })
        }
        return true
      }),
    )
    if (!connected) await unsubscribeOrphan(row.id, page)
    return connected ? "connected" : "failed"
  } finally {
    if (!connected && !keepLease) await giveLeaseBack().catch(() => {})
  }
}

/**
 * Meta confirmed our subscribe, but the connection ended while it was on its
 * way. If the release has already wiped the row, nothing left in the database
 * could undo that subscription — so it is undone here, at once, with the Page
 * token still in hand, after Meta's answer to the subscribe and so after it.
 * Unless an organisation relies on the Page (or its Instagram account), or
 * another live demo holds it: then the subscription is theirs too.
 * A row that is not wiped yet is unsubscribed by the release as well; asking
 * Meta twice is harmless.
 */
async function unsubscribeOrphan(connectionId: string, page: MetaPage): Promise<void> {
  const ids = page.instagramId ? [page.id, page.instagramId] : [page.id]
  if ((await claimedMetaPageIds(ids)).length > 0) return
  const heldByAnotherDemo = await runWithRlsBypass(() =>
    prisma.demoSocialConnection.count({
      where: { platform: "facebook", scrubbedAt: null, pageId: page.id, id: { not: connectionId } },
    }),
  )
  if (heldByAnotherDemo) return
  const outcome = await unsubscribePageFromApp(page.id, page.token)
  if (outcome.verdict !== "removed" && outcome.verdict !== "gone") {
    // A code of ours only, never Meta's text or an id.
    console.warn(`[demo-social-oauth] a Page subscribed after its connection ended was not unsubscribed: ${outcome.code ?? outcome.verdict}`)
  }
}

// --- The way back from Meta ------------------------------------------------

/** What the callback tab says. Never an id, a name or Meta's text. */
export type DemoSocialCallbackResult = "connected" | "choose" | "refused" | "denied" | "expired" | "failed"

/**
 * The callback for a demo state. In order: the signature and age of the
 * state; the nonce this browser holds against the row's hash, consumed once;
 * the row still live and its grant still allowed; the app the start used.
 * Then the code exchange, the user token stored, the Pages read, and one
 * Page bound — or the choice stored, ids and names only.
 */
export async function completeDemoSocialConnect(input: {
  state: string
  code: string | null
  nonce: string | null
  now?: Date
}): Promise<DemoSocialCallbackResult> {
  const now = input.now ?? new Date()
  const checked = readDemoSocialState(input.state, now)
  if (!checked.ok) return checked.reason === "expired" ? "expired" : "failed"
  if (!input.nonce || input.nonce.length > 200) return "failed"
  const nonceHash = demoSocialNonceHash(input.nonce)

  const row = await runWithRlsBypass(() =>
    prisma.demoSocialConnection.findUnique({ where: { id: checked.connectionId }, select: DEMO_SOCIAL_ROW_SELECT }),
  )
  if (!row || row.scrubbedAt || !row.oauthStateHash || !hashesMatch(row.oauthStateHash, nonceHash)) return "failed"
  // One use: a replayed callback finds nothing to consume.
  const consumed = await runWithRlsBypass(() =>
    prisma.demoSocialConnection.updateMany({
      where: { id: row.id, scrubbedAt: null, oauthStateHash: row.oauthStateHash },
      data: { oauthStateHash: null },
    }),
  )
  if (!consumed.count) return "failed"
  if (demoSocialReleaseReason(row, now)) return "expired"
  if (!row.grant || !demoSocialGrantAllowed(row.grant, now)) return "expired"
  if (row.connectedAt || row.pageId) return "failed"

  if (!input.code) {
    // The person cancelled, or Meta refused the request.
    await markRefused(row.id)
    return "denied"
  }
  const target = await demoSocialMetaApp()
  if (!target || target.app.configId !== row.appConfigId) {
    await markRefused(row.id)
    return "failed"
  }

  const userToken = await longLivedUserToken(target, input.code)
  if (!userToken) {
    await markRefused(row.id)
    return "failed"
  }
  // Recorded before anything else is asked of Meta with it.
  await runWithRlsBypass(() =>
    prisma.demoSocialConnection.updateMany({
      where: { id: row.id, scrubbedAt: null, connectedAt: null, pageId: null },
      data: { userTokenCipher: encryptToken(userToken, demoSocialTokenPurpose(row.id, "user")) },
    }),
  )
  const userId = await metaUserId(userToken)
  if (userId) {
    await runWithRlsBypass(() =>
      prisma.demoSocialConnection.updateMany({ where: { id: row.id, scrubbedAt: null }, data: { metaUserId: userId } }),
    )
  }

  const pages = await grantedPages(target, userToken)
  if (!pages) {
    await markRefused(row.id)
    return "failed"
  }
  const usable = await connectablePages(pages, row.id)
  if (!usable.length) {
    await markRefused(row.id)
    return "refused"
  }
  if (usable.length > 1) {
    const stored = await runWithRlsBypass(() =>
      prisma.demoSocialConnection.updateMany({
        where: { id: row.id, scrubbedAt: null, connectedAt: null, pageId: null },
        data: { pendingPages: usable.map((page) => ({ id: page.id, name: page.name })) },
      }),
    )
    return stored.count ? "choose" : "failed"
  }
  return await bindPage(row, usable[0], now)
}

// --- The choice ------------------------------------------------------------

export type ChooseDemoSocialResult = { ok: true } | { ok: false; code: "not_enabled" | "not_choosing" | "refused" | "failed" }

/**
 * Several Pages were granted and the prospect picked one on the demo page.
 * The Page is read again with his token — its own Page token, and whether it
 * is still his — and checked again: something may have claimed it meanwhile.
 */
export async function chooseDemoSocialPage(grant: DemoSocialGrant, index: number, now: Date = new Date()): Promise<ChooseDemoSocialResult> {
  if (!demoSocialGrantAllowed(grant, now)) return { ok: false, code: "not_enabled" }
  const row = await runWithRlsBypass(() =>
    prisma.demoSocialConnection.findFirst({
      where: { grantId: grant.id, platform: "facebook", scrubbedAt: null },
      select: { ...DEMO_SOCIAL_ROW_SELECT },
    }),
  )
  if (!row || demoSocialReleaseReason(row, now) || row.connectedAt || row.pageId || !row.userTokenCipher) return { ok: false, code: "not_choosing" }
  const pending = pendingPagesOf(row.pendingPages)
  const chosen = pending?.[index]
  if (!chosen) return { ok: false, code: "not_choosing" }
  let userToken: string
  try {
    userToken = decryptToken(row.userTokenCipher, demoSocialTokenPurpose(row.id, "user"))
  } catch {
    return { ok: false, code: "failed" }
  }
  if (!userToken) return { ok: false, code: "failed" }
  const page = await fetchPage(chosen.id, userToken)
  if (!page) return { ok: false, code: "failed" }
  const [usable] = await connectablePages([page], row.id)
  if (!usable) {
    await markRefused(row.id)
    return { ok: false, code: "refused" }
  }
  const bound = await bindPage(row, usable, now)
  return bound === "connected" ? { ok: true } : { ok: false, code: bound }
}
