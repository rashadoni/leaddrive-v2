import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { decryptToken } from "@/lib/secure-token"
import { claimedMetaPageIds } from "@/lib/social/meta-page-claims"
import { unsubscribePageFromApp, type GraphOutcome } from "@/lib/social/meta-unbind"
import {
  demoSocialReleaseReason,
  demoSocialTokenPurpose,
  type DemoSocialReleaseReason,
} from "./demo-social-connection"

/**
 * Unbinding the prospects' Facebook Pages (docs/DEMO_CENTER.md, «Live social
 * connections»). Run every five minutes by /api/cron/demo-social-release.
 *
 * For each connection `demoSocialReleaseReason` says is over — rows never
 * tried first, so one row Meta keeps failing cannot starve the others:
 *   1. claim a two-minute lease on the clock of the claim itself, so two runs
 *      never send the same Meta call however long ago a run started;
 *   2. unsubscribe the Page from our app — unless some organisation claims the
 *      Page or the Instagram account linked to it;
 *   3. record that the person's grant stays with him (nothing is sent);
 *   4. wipe our copy in one transaction: the messages, every secret and
 *      identifier; `scrubbedAt` set and the outcome written to the access trail.
 * Every run also deletes any message of a connection already wiped — the
 * backstop for a message that raced the wipe.
 *
 * A Page being bound right now holds the same lease (demo-social-oauth.ts,
 * `bindPage`), so the unsubscribe never goes out while our subscribe is still
 * on its way to Meta.
 *
 * Unbinding means: the Page no longer delivers to our app, and every token and
 * identifier of ours is gone. It deliberately does not take back the person's
 * whole Meta grant (`DELETE /me/permissions`):
 *   - a revoke can never be proven safe. One grant covers every Page the
 *     person granted, and `/me/accounts` does not list Pages reached through
 *     a business portfolio (src/lib/social/meta-granted-assets.ts, observed
 *     2026-09-20 on app 2414060595720618), so «none of his Pages is claimed»
 *     cannot be read off it — only `debug_token` would say;
 *   - on the owner's own account it would kill LeadDrive Inc.'s staged Page
 *     tokens;
 *   - it let one row's revoke kill a due sibling's Page token before that
 *     sibling had unsubscribed its Page.
 * So the user token is never decrypted here. The authorization stays with the
 * person, who can remove LeadDrive in Meta's Business Integrations: the connect
 * panel (PR 2) links there, and its consent text must say so.
 *
 * A finished step is recorded at once and never repeated. An unsubscribe Meta
 * did not answer is tried again on the next tick; 24 hours after the release
 * was asked for, the row is wiped anyway with the outcome `unreachable` and a
 * SOCIAL_RELEASE_INCOMPLETE event. Until then the connection is already dead
 * for every use: the live check stops the webhook, the sends and the page.
 *
 * The engine enters RLS bypass itself: the demo tables are bypass-only, and a
 * caller without it would read zero rows and report «nothing due, all fine».
 * It never enters a tenant and never writes a tenant table; the only tenant
 * rows it reads are the claim checks, by Meta id, ids only.
 */

export const DEMO_SOCIAL_RELEASE_LEASE_MS = 2 * 60_000
/** After this long past the release request, a Meta step that never answered counts as `unreachable`. */
export const DEMO_SOCIAL_RELEASE_GIVE_UP_MS = 24 * 60 * 60_000
/** A row this long past its expiry that no run ever tried means the cron is not running. */
export const DEMO_SOCIAL_STRANDED_AFTER_MS = 30 * 60_000
const DEFAULT_LIMIT = 50
const OPEN_ROWS_READ = 500
/** Stop starting rows after this long, well inside the five-minute tick. */
const RUN_BUDGET_MS = 3 * 60_000
const INCOMPLETE_LOOKBACK_MS = 7 * 24 * 60 * 60_000

export type DemoSocialUnsubscribeOutcome =
  | "removed" | "gone" | "not_subscribed" | "kept_claimed" | "token_invalid" | "refused" | "decrypt_failed" | "unreachable"
/** The grant is never revoked: kept by design when we held a user token, nothing to keep when we did not. */
export type DemoSocialGrantRevokeOutcome = "kept_by_design" | "no_token"

/**
 * Unsubscribe outcomes after which our app may still be bound to the Page at
 * Meta although we asked: the release is recorded as incomplete. A deliberate
 * keep (`kept_claimed`) is not one — someone else relies on that binding.
 */
const INCOMPLETE_OUTCOMES: ReadonlySet<string> = new Set(["refused", "decrypt_failed", "unreachable"])

export interface DemoSocialGraph {
  unsubscribePageFromApp(pageId: string, pageToken: string): Promise<GraphOutcome>
}

const META_GRAPH: DemoSocialGraph = {
  unsubscribePageFromApp: (pageId, pageToken) => unsubscribePageFromApp(pageId, pageToken),
}

export type DemoSocialClaims = (pageIds: readonly string[]) => Promise<string[]>

export interface DemoSocialReleaseRun {
  /** Unwiped rows read. */
  checked: number
  /** Of those, the ones whose connection is over. */
  due: number
  /** Wiped in this run, incomplete ones included. */
  released: number
  /** Due and not wiped in this run: Meta did not answer, another run holds the lease, or the run's budget ran out. */
  retrying: number
  /** Wiped in this run although Meta may still hold the binding. */
  incomplete: number
}

export interface DemoSocialReleaseHealth {
  live: number
  due: number
  /** Unwiped, more than 30 minutes past expiry, never tried: the cron is not running. */
  stranded: number
  incompleteLast7d: number
}

const LIVENESS_SELECT = {
  id: true,
  grantId: true,
  releaseReason: true,
  releaseAttempts: true,
  connectedAt: true,
  createdAt: true,
  expiresAt: true,
  grant: {
    select: {
      status: true,
      linkExpiresAt: true,
      verificationExpiresAt: true,
      sessionStartedAt: true,
      sessionLastSeenAt: true,
      sessionExpiresAt: true,
      inactivityMinutes: true,
    },
  },
} satisfies Prisma.DemoSocialConnectionSelect

const RELEASE_SELECT = {
  id: true,
  grantId: true,
  platform: true,
  userTokenCipher: true,
  pageTokenCipher: true,
  pageId: true,
  linkedInstagramId: true,
  releaseRequestedAt: true,
  releaseReason: true,
  releaseAttempts: true,
  releaseError: true,
  unsubscribeOutcome: true,
  scrubbedAt: true,
} satisfies Prisma.DemoSocialConnectionSelect

type ReleaseRow = Prisma.DemoSocialConnectionGetPayload<{ select: typeof RELEASE_SELECT }>
type LivenessRow = Prisma.DemoSocialConnectionGetPayload<{ select: typeof LIVENESS_SELECT }>

interface Deps {
  graph: DemoSocialGraph
  claims: DemoSocialClaims
}

/** A step either settles (`outcome`) or asks to be tried again (`outcome: null`). */
type Step<T> = { outcome: T | null; code: string | null }

function decrypted(cipher: string, purpose: string): string | null {
  try {
    const token = decryptToken(cipher, purpose)
    return token || null
  } catch {
    return null
  }
}

async function unsubscribeStep(row: ReleaseRow, deps: Deps): Promise<Step<DemoSocialUnsubscribeOutcome>> {
  // The Page token is stored before the subscription is asked for, so no token
  // means we never subscribed this Page.
  if (!row.pageId || !row.pageTokenCipher) return { outcome: "not_subscribed", code: null }
  // An organisation may rely on the Page through Instagram alone: its channel
  // or monitored account is stored under the linked Instagram account's id,
  // and those DMs ride this Page's subscription.
  const ids = row.linkedInstagramId ? [row.pageId, row.linkedInstagramId] : [row.pageId]
  if ((await deps.claims(ids)).length > 0) return { outcome: "kept_claimed", code: null }
  const token = decrypted(row.pageTokenCipher, demoSocialTokenPurpose(row.id, "page"))
  if (!token) return { outcome: "decrypt_failed", code: null }
  const result = await deps.graph.unsubscribePageFromApp(row.pageId, token)
  if (result.verdict === "retry") return { outcome: null, code: result.code }
  return { outcome: result.verdict, code: result.code }
}

/** Sends nothing and never decrypts the user token: the grant stays with the person (see the module's comment). */
function grantStep(row: ReleaseRow): DemoSocialGrantRevokeOutcome {
  return row.userTokenCipher ? "kept_by_design" : "no_token"
}

type RowResult = "released" | "incomplete" | "retrying"

async function releaseOne(id: string, reason: DemoSocialReleaseReason, now: Date, deps: Deps): Promise<RowResult> {
  // The first moment the release was asked for: the 24-hour clock starts here.
  await prisma.demoSocialConnection.updateMany({
    where: { id, scrubbedAt: null, releaseRequestedAt: null },
    data: { releaseRequestedAt: now, releaseReason: reason },
  })
  // The lease is read and set on the clock at this moment, not on the run's
  // `now`: a run that started minutes ago would otherwise hand out a lease
  // that has already run out, and a second run would send the same call.
  const claimedAt = new Date()
  const claimed = await prisma.demoSocialConnection.updateMany({
    where: { id, scrubbedAt: null, OR: [{ releaseLeaseUntil: null }, { releaseLeaseUntil: { lte: claimedAt } }] },
    data: { releaseLeaseUntil: new Date(claimedAt.getTime() + DEMO_SOCIAL_RELEASE_LEASE_MS), releaseAttempts: { increment: 1 } },
  })
  if (claimed.count === 0) return "retrying"
  const row: ReleaseRow | null = await prisma.demoSocialConnection.findUnique({ where: { id }, select: RELEASE_SELECT })
  if (!row || row.scrubbedAt) return "retrying"

  // Every write below is fenced by this claim's attempt number: a run whose
  // lease ran out and was taken over writes nothing.
  const fence = { id, scrubbedAt: null, releaseAttempts: row.releaseAttempts }
  const givingUp = !!row.releaseRequestedAt && now.getTime() - row.releaseRequestedAt.getTime() >= DEMO_SOCIAL_RELEASE_GIVE_UP_MS
  let lastCode: string | null = null

  let unsubscribe = row.unsubscribeOutcome as DemoSocialUnsubscribeOutcome | null
  if (!unsubscribe) {
    const step = await unsubscribeStep(row, deps)
    lastCode = step.code ?? lastCode
    unsubscribe = step.outcome ?? (givingUp ? "unreachable" : null)
    const saved = await prisma.demoSocialConnection.updateMany({
      where: fence,
      data: unsubscribe ? { unsubscribeOutcome: unsubscribe, releaseError: lastCode ?? row.releaseError } : { releaseError: lastCode },
    })
    if (saved.count === 0 || !unsubscribe) return "retrying"
  }

  const grantRevoke = grantStep(row)
  const incomplete = INCOMPLETE_OUTCOMES.has(unsubscribe)
  const metadata = { platform: row.platform, reason: row.releaseReason ?? reason, unsubscribe, grantRevoke }
  const wiped = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const done = await tx.demoSocialConnection.updateMany({
      where: fence,
      data: {
        scrubbedAt: now,
        releaseLeaseUntil: null,
        unsubscribeOutcome: unsubscribe,
        grantRevokeOutcome: grantRevoke,
        releaseError: lastCode ?? row.releaseError,
        oauthStateHash: null,
        metaUserId: null,
        userTokenCipher: null,
        pageTokenCipher: null,
        pendingPages: Prisma.DbNull,
        pageId: null,
        pageName: null,
        linkedInstagramId: null,
        provenSenderId: null,
      },
    })
    if (done.count === 0) return false
    await tx.demoSocialMessage.deleteMany({ where: { connectionId: id } })
    // A grant that is gone takes its trail with it; the wiped row is the record.
    if (row.grantId) {
      if (incomplete) {
        await tx.demoAccessEvent.create({ data: { grantId: row.grantId, eventType: "SOCIAL_RELEASE_INCOMPLETE", metadata } })
      } else {
        await tx.demoAccessEvent.create({ data: { grantId: row.grantId, eventType: "SOCIAL_RELEASED", metadata } })
      }
    }
    return true
  })
  if (!wiped) return "retrying"
  return incomplete ? "incomplete" : "released"
}

/** Rows never tried first, then the oldest end, then the id: a row Meta keeps failing goes to the back. */
function releaseOrder(a: LivenessRow, b: LivenessRow): number {
  return (
    a.releaseAttempts - b.releaseAttempts ||
    a.expiresAt.getTime() - b.expiresAt.getTime() ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
}

export async function releaseDueDemoSocialConnections(
  options: { now?: Date; graph?: DemoSocialGraph; claims?: DemoSocialClaims; limit?: number } = {},
): Promise<DemoSocialReleaseRun> {
  const now = options.now ?? new Date()
  const deps: Deps = { graph: options.graph ?? META_GRAPH, claims: options.claims ?? claimedMetaPageIds }
  const limit = options.limit ?? DEFAULT_LIMIT
  return runWithRlsBypass(async () => {
    // The backstop behind the inbound path's row lock (demo-social-inbound.ts):
    // a message of a connection that is already wiped is deleted on every run,
    // whatever wrote it and whenever.
    const strays = await prisma.demoSocialMessage.deleteMany({ where: { connection: { scrubbedAt: { not: null } } } })
    if (strays.count) console.warn(`[demo-social-release] deleted ${strays.count} message(s) of connections already wiped`)
    const open: LivenessRow[] = await prisma.demoSocialConnection.findMany({
      where: { scrubbedAt: null },
      select: LIVENESS_SELECT,
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      take: OPEN_ROWS_READ,
    })
    const due: Array<{ row: LivenessRow; reason: DemoSocialReleaseReason }> = []
    for (const row of open) {
      const reason = demoSocialReleaseReason(row, now)
      if (reason) due.push({ row, reason })
    }
    due.sort((a, b) => releaseOrder(a.row, b.row))
    const run: DemoSocialReleaseRun = { checked: open.length, due: due.length, released: 0, retrying: 0, incomplete: 0 }
    const started = Date.now()
    for (const [index, { row, reason }] of due.entries()) {
      if (index >= limit || Date.now() - started > RUN_BUDGET_MS) {
        run.retrying += 1
        continue
      }
      try {
        const result = await releaseOne(row.id, reason, now, deps)
        if (result === "retrying") run.retrying += 1
        else {
          run.released += 1
          if (result === "incomplete") run.incomplete += 1
        }
      } catch (error) {
        // The name only: a database error's message can quote the row.
        console.warn(`[demo-social-release] a release failed and will be retried: ${error instanceof Error ? error.name : "error"}`)
        run.retrying += 1
      }
    }
    return run
  })
}

/** What the deploy reads through the cron's smoke call. Reads only. */
export async function demoSocialReleaseHealth(now: Date = new Date()): Promise<DemoSocialReleaseHealth> {
  return runWithRlsBypass(async () => {
    const open: LivenessRow[] = await prisma.demoSocialConnection.findMany({ where: { scrubbedAt: null }, select: LIVENESS_SELECT, take: OPEN_ROWS_READ })
    let live = 0
    let due = 0
    for (const row of open) {
      if (demoSocialReleaseReason(row, now)) due += 1
      else live += 1
    }
    const stranded = await prisma.demoSocialConnection.count({
      where: { scrubbedAt: null, releaseAttempts: 0, expiresAt: { lt: new Date(now.getTime() - DEMO_SOCIAL_STRANDED_AFTER_MS) } },
    })
    const incompleteLast7d = await prisma.demoSocialConnection.count({
      where: {
        scrubbedAt: { gte: new Date(now.getTime() - INCOMPLETE_LOOKBACK_MS) },
        unsubscribeOutcome: { in: [...INCOMPLETE_OUTCOMES] },
      },
    })
    return { live, due, stranded, incompleteLast7d }
  })
}
