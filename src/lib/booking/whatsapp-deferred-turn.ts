/**
 * Giving the booking agent its turn back, a minute late, on a number the team answers from a phone.
 *
 * On a coexistence channel nothing of ours answers inside the webhook: our reply would leave in two
 * seconds and the person holding the phone needs thirty (lib/inbox/whatsapp-reply-hold). That bought
 * safety at a price — the booking agent stopped offering times at all on such a number, so a salon
 * whose WhatsApp books appointments lost the feature it connected us for. This is the other half:
 * wait out the grace, and if the customer is still waiting, let the agent answer after all.
 *
 * Three rules decide a candidate, and all three are about not talking over a human:
 *
 *   1. **The grace has passed.** Not a guess at how fast people type — the point is only that the
 *      person with the phone gets the first word. One minute by default.
 *   2. **Nobody has answered.** Any outbound row newer than the customer's message means somebody
 *      did: our own earlier send, an operator in the inbox, or — the case this exists for — a reply
 *      typed in the WhatsApp Business app, which arrives as exactly such a row
 *      (lib/inbox/whatsapp-app-echo). The echo is what makes this correct rather than hopeful.
 *   3. **The message is still worth answering.** Past the cap, a booking request has gone cold:
 *      answering "here are three times" an hour later is worse than silence.
 *
 * And one rule about not talking twice: the claim. `deferredTurnAt` is stamped by a conditional
 * update BEFORE the agent is asked anything, so two overlapping runs cannot both take a message,
 * and a crash mid-send costs one unanswered customer instead of a model call every minute forever.
 *
 * What this deliberately does NOT do: decide whether the message is about booking. That is
 * `handleWhatsAppBookingTurn`'s judgement and it already answers `handled: false` for everything
 * else — a second opinion here would be a second place to keep in step with it.
 */
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { withJobLease } from "@/lib/cron/job-lease"
import { sanitizeLog } from "@/lib/sanitize"
import { deferredReplyEnabled } from "@/lib/inbox/whatsapp-reply-hold"

/** How long the person with the phone has before the agent may answer. */
export const DEFERRED_TURN_GRACE_MS = 60_000
/** Past this, a request for a time is cold and stays unanswered. */
export const DEFERRED_TURN_CAP_MS = 15 * 60_000
/** Per run, across all workspaces. A backlog must not become a burst of messages. */
export const DEFERRED_TURN_LIMIT = 20

export type DeferredTurnOutcome = {
  channels: number
  candidates: number
  answered: number
  declined: number
  answeredElsewhere: number
  failed: number
}

type Candidate = {
  id: string
  organizationId: string
  channelConfigId: string
  conversationId: string
  body: string
  from: string
  createdAt: Date
  metadata: unknown
}

function waPhoneOf(metadata: unknown, fallback: string): string {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const value = (metadata as Record<string, unknown>).waPhone
    if (typeof value === "string" && value) return value
  }
  return fallback
}

/**
 * Held channels, across every workspace.
 *
 * Resolution by a channel-level setting is the cross-tenant phase, so it runs under bypass; every
 * answer below is scoped back to the owning workspace with `runWithTenant`.
 */
async function heldChannels() {
  const rows = await runWithRlsBypass(() =>
    prisma.channelConfig.findMany({
      where: { channelType: "whatsapp", isActive: true },
      select: { id: true, organizationId: true, settings: true },
    }),
  )
  return rows.filter((row) => deferredReplyEnabled(row.settings))
}

/** Customer messages on this channel that nobody has taken responsibility for yet. */
async function pendingFor(channel: { id: string; organizationId: string }, now: Date, limit: number): Promise<Candidate[]> {
  const rows = await prisma.channelMessage.findMany({
    where: {
      organizationId: channel.organizationId,
      channelConfigId: channel.id,
      channelType: "whatsapp",
      direction: "inbound",
      deferredTurnAt: null,
      createdAt: { lt: new Date(now.getTime() - DEFERRED_TURN_GRACE_MS), gt: new Date(now.getTime() - DEFERRED_TURN_CAP_MS) },
      conversationId: { not: null },
      NOT: { body: "" },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      id: true, organizationId: true, channelConfigId: true, conversationId: true,
      body: true, from: true, createdAt: true, metadata: true,
    },
  })
  return rows.flatMap((row) => (row.channelConfigId && row.conversationId
    ? [{ ...row, channelConfigId: row.channelConfigId, conversationId: row.conversationId }]
    : []))
}

/**
 * Has anybody answered this customer since?
 *
 * Deliberately any outbound row, with no reading of who sent it: an operator's reply, our own
 * earlier message and a reply typed on the phone are all equally "answered", and treating one of
 * them as not counting is how a customer ends up answered twice.
 */
async function answeredSince(candidate: Candidate): Promise<boolean> {
  const later = await prisma.channelMessage.findFirst({
    where: {
      organizationId: candidate.organizationId,
      conversationId: candidate.conversationId,
      direction: "outbound",
      createdAt: { gt: candidate.createdAt },
    },
    select: { id: true },
  })
  return !!later
}

/** Take responsibility for this message, or lose the race. One UPDATE decides. */
async function claim(candidate: Candidate, now: Date): Promise<boolean> {
  const claimed = await prisma.channelMessage.updateMany({
    where: { id: candidate.id, organizationId: candidate.organizationId, deferredTurnAt: null },
    data: { deferredTurnAt: now },
  })
  return claimed.count === 1
}

/**
 * One pass. Safe to call as often as a schedule allows: everything it might do is claimed first.
 *
 * `answer` is injectable so the tests can watch what the agent was asked, without the model.
 */
export async function runWhatsAppDeferredTurns(options: {
  now?: Date
  limit?: number
  answer?: (input: {
    organizationId: string
    channelConfigId: string
    conversationId: string
    waPhone: string
    senderName: string
    text: string
  }) => Promise<{ handled: boolean }>
} = {}): Promise<DeferredTurnOutcome> {
  const now = options.now ?? new Date()
  const limit = Math.max(1, Math.min(options.limit ?? DEFERRED_TURN_LIMIT, 50))
  const out: DeferredTurnOutcome = { channels: 0, candidates: 0, answered: 0, declined: 0, answeredElsewhere: 0, failed: 0 }

  const answer = options.answer ?? (async (input) => {
    const { handleWhatsAppBookingTurn } = await import("@/lib/booking/whatsapp-agent")
    return handleWhatsAppBookingTurn({ ...input, replyId: null })
  })

  const channels = await heldChannels()
  out.channels = channels.length
  let budget = limit

  for (const channel of channels) {
    if (budget <= 0) break
    const candidates = await runWithTenant(channel.organizationId, () => pendingFor(channel, now, budget))
    for (const candidate of candidates) {
      if (budget <= 0) break
      budget -= 1
      out.candidates += 1
      try {
        await runWithTenant(channel.organizationId, async () => {
          // Checked before the claim so a message somebody answered is left unclaimed and simply
          // ages out — stamping it would be a lie about who dealt with it.
          if (await answeredSince(candidate)) {
            out.answeredElsewhere += 1
            return
          }
          if (!await claim(candidate, now)) {
            out.answeredElsewhere += 1
            return
          }
          const result = await answer({
            organizationId: candidate.organizationId,
            channelConfigId: candidate.channelConfigId,
            conversationId: candidate.conversationId,
            waPhone: waPhoneOf(candidate.metadata, candidate.from),
            senderName: candidate.from,
            text: candidate.body,
          })
          if (result.handled) out.answered += 1
          else out.declined += 1
        })
      } catch (error) {
        // The claim stands: a message whose answer failed is not retried. One silence beats a model
        // call every minute and a customer answered on the fifth attempt.
        out.failed += 1
        console.error(`[WA Deferred] org=${sanitizeLog(channel.organizationId)} message=${sanitizeLog(candidate.id)} failed:`, error)
      }
    }
  }

  if (out.candidates || out.channels) {
    console.log(
      `[WA Deferred] channels=${out.channels} candidates=${out.candidates} answered=${out.answered}`
      + ` declined=${out.declined} answeredElsewhere=${out.answeredElsewhere} failed=${out.failed}`,
    )
  }
  return out
}

/** The scheduled entry point: one run at a time across the fleet. */
export async function runWhatsAppDeferredTurnJob() {
  return withJobLease({ name: "whatsapp-deferred-turn", ttlMs: 120_000 }, () => runWhatsAppDeferredTurns())
}
