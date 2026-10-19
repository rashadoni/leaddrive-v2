import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { demoSocialReleaseReason } from "./demo-social-connection"
import { DEMO_SOCIAL_MAX_AI_REPLIES } from "./demo-social-inbound"
import {
  DEMO_SOCIAL_ROW_SELECT,
  chooseDemoSocialPage,
  demoSocialGrantAllowed,
  demoSocialMetaApp,
  pendingPagesOf,
  requestDemoSocialRelease,
  startDemoSocialConnect,
  type DemoSocialGrant,
  type DemoSocialRow,
} from "./demo-social-oauth"

/**
 * The demo page's view of the prospect's own Facebook Page (docs/DEMO_CENTER.md,
 * «Live social connections»), and what the page may ask of it: start the
 * connect, pick one of several Pages, or «Ayır».
 *
 * What it projects is the Page's name, this session's code, the end of the
 * connection, and the proven sender's conversation with the demo's agent —
 * text, direction and time. Never an id: not the row's, the grant's, the
 * Page's, the Instagram account's, the sender's, the Meta user's or a
 * message's; never a token. The Messenger link goes through a route of ours
 * (`…/social/messenger`) so the Page id is not in this answer either.
 */

/** Where the connection is, as the panel draws it. */
export type DemoSocialPhase =
  /** Nothing connected: the offer, the consent line and the button. */
  | "offer"
  /** Meta's dialog is open in another tab, or its answer is being read. */
  | "waiting"
  /** Several Pages were granted: which one? */
  | "choose"
  /** Nothing usable came back: no Page, no permission, or only Pages LeadDrive already serves. */
  | "refused"
  | "connected"
  /** «Ayır», the day's end or the session's: the Page is being unsubscribed. */
  | "releasing"

export interface DemoSocialMessageView {
  readonly direction: "inbound" | "outbound"
  /** The prospect (whoever wrote with the code), or the demo's AI agent. */
  readonly by: "prospect" | "ai"
  readonly text: string
  readonly at: string
}

export interface DemoSocialState {
  readonly enabled: boolean
  readonly phase: DemoSocialPhase
  /** The last connection of this session was released and wiped: say so, and where Meta's own switch is. */
  readonly released: boolean
  /** In «choose»: the granted Pages' names, in the order the choice refers to. */
  readonly pages: readonly string[]
  readonly pageName: string | null
  /** This session's code; shown only once a Page is connected. */
  readonly code: string | null
  /** When the connection ends at the latest: 23:59 in Baku. */
  readonly until: string | null
  /** Someone wrote to the Page with the code: the conversation is his alone. */
  readonly proven: boolean
  readonly agentActive: boolean
  readonly repliesLeft: number
  readonly messages: readonly DemoSocialMessageView[]
  /** «releasing» a connect that never finished: the panel says it did not connect. */
  readonly connectFailed: boolean
}

/** What the demo inbox shows of a connected Page: the real Facebook row. */
export interface DemoSocialInboxView {
  readonly pageName: string
  readonly code: string
  readonly proven: boolean
  readonly messages: readonly DemoSocialMessageView[]
}

const MESSAGES_SHOWN = 12

const OFF: DemoSocialState = {
  enabled: false,
  phase: "offer",
  released: false,
  pages: [],
  pageName: null,
  code: null,
  until: null,
  proven: false,
  agentActive: false,
  repliesLeft: 0,
  messages: [],
  connectFailed: false,
}

/** Both switches: the server's app and the admin's tick on this grant, in a live session. */
export async function demoSocialEnabledFor(grant: DemoSocialGrant, now: Date = new Date()): Promise<boolean> {
  if (!demoSocialGrantAllowed(grant, now)) return false
  return (await demoSocialMetaApp()) !== null
}

async function latestRow(grantId: string): Promise<DemoSocialRow | null> {
  return await runWithRlsBypass(async () =>
    (await prisma.demoSocialConnection.findFirst({
      where: { grantId, platform: "facebook", scrubbedAt: null },
      select: DEMO_SOCIAL_ROW_SELECT,
    }))
    ?? (await prisma.demoSocialConnection.findFirst({
      where: { grantId, platform: "facebook" },
      orderBy: { createdAt: "desc" },
      select: DEMO_SOCIAL_ROW_SELECT,
    })),
  )
}

export async function demoSocialState(grant: DemoSocialGrant, now: Date = new Date()): Promise<DemoSocialState> {
  if (!(await demoSocialEnabledFor(grant, now))) return OFF
  const row = await latestRow(grant.id)
  if (!row) return { ...OFF, enabled: true }
  // «Ayrıldı» only where a Page was connected; a connect that never finished just offers again.
  if (row.scrubbedAt) return { ...OFF, enabled: true, released: Boolean(row.connectedAt) }
  if (demoSocialReleaseReason(row, now)) {
    return { ...OFF, enabled: true, phase: "releasing", connectFailed: !row.connectedAt }
  }
  if (!row.connectedAt) {
    const pending = pendingPagesOf(row.pendingPages)
    if (pending && pending.length) return { ...OFF, enabled: true, phase: "choose", pages: pending.map((page) => page.name) }
    if (pending && !pending.length) return { ...OFF, enabled: true, phase: "refused" }
    return { ...OFF, enabled: true, phase: "waiting" }
  }
  const messages = row.provenAt
    ? (await runWithRlsBypass(() =>
      prisma.demoSocialMessage.findMany({
        where: { connectionId: row.id },
        orderBy: { createdAt: "desc" },
        take: MESSAGES_SHOWN,
        select: { direction: true, text: true, createdAt: true },
      }),
    )).reverse().map((message: { direction: string; text: string; createdAt: Date }): DemoSocialMessageView => ({
      direction: message.direction === "outbound" ? "outbound" : "inbound",
      by: message.direction === "outbound" ? "ai" : "prospect",
      text: message.text,
      at: message.createdAt.toISOString(),
    }))
    : []
  const repliesLeft = Math.max(0, DEMO_SOCIAL_MAX_AI_REPLIES - row.aiReplies)
  return {
    ...OFF,
    enabled: true,
    phase: "connected",
    pageName: row.pageName,
    code: row.code,
    until: row.expiresAt.toISOString(),
    proven: Boolean(row.provenAt),
    agentActive: repliesLeft > 0,
    repliesLeft,
    messages,
  }
}

export type DemoSocialActionResult =
  | { ok: true; state: DemoSocialState; url?: string; nonce?: string }
  | { ok: false; code: "not_enabled" | "busy" | "releasing" | "already_connected" | "in_progress" | "not_choosing" | "refused" | "failed" | "not_connected" }

export async function startDemoSocial(grant: DemoSocialGrant, now: Date = new Date()): Promise<DemoSocialActionResult> {
  const started = await startDemoSocialConnect(grant, now)
  if (!started.ok) return started
  return { ok: true, url: started.url, nonce: started.nonce, state: await demoSocialState(grant, now) }
}

export async function chooseDemoSocial(grant: DemoSocialGrant, index: number, now: Date = new Date()): Promise<DemoSocialActionResult> {
  const chosen = await chooseDemoSocialPage(grant, index, now)
  if (!chosen.ok) return chosen
  return { ok: true, state: await demoSocialState(grant, now) }
}

/** «Ayır»: the release is asked for now; every use stops at once and the cron unbinds within five minutes. */
export async function disconnectDemoSocial(grant: DemoSocialGrant, now: Date = new Date()): Promise<DemoSocialActionResult> {
  if (!(await demoSocialEnabledFor(grant, now))) return { ok: false, code: "not_enabled" }
  const requested = await requestDemoSocialRelease({ grantId: grant.id }, "disconnected", now)
  if (!requested) return { ok: false, code: "not_connected" }
  return { ok: true, state: await demoSocialState(grant, now) }
}

/**
 * The prospect's Page, for the Messenger link: only a connected, live
 * connection of this session's grant. Read by our own redirect route, never
 * put into an answer the page reads.
 */
export async function demoSocialMessengerPageId(grant: DemoSocialGrant, now: Date = new Date()): Promise<string | null> {
  if (!(await demoSocialEnabledFor(grant, now))) return null
  const row = await latestRow(grant.id)
  if (!row || row.scrubbedAt || !row.connectedAt || !row.pageId || demoSocialReleaseReason(row, now)) return null
  return row.pageId
}
