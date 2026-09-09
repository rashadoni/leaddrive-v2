/**
 * C4 (Creatio 10X roadmap) — web-activity workflow triggers.
 *
 * When a batch of tracked page views/events lands on a session that is already
 * stitched to a Contact (C2), fire the org's workflow rules with
 * entityType="contact", triggerEvent="web_activity". The entity carries the
 * contact's own fields PLUS the web context, so rule conditions can express
 * both the roadmap example («посетил /pricing дважды за неделю → задача») via
 * `highIntentViews7d greater_than 1`, and simpler ones like
 * `pageUrl contains /pricing` or `isHighIntent equals true`.
 *
 * Fired once per ingest batch (not per pageview) — a browsing spree is one
 * signal, and rules that need volume use the 7-day counters. Callers own the
 * RLS scope and fire-and-forget the promise from inside it.
 */
import type { PrismaClient } from "@prisma/client"
import { classifyPageUrl } from "./account-engagement/track-pixel"
import { executeWorkflows } from "./workflow-engine"

export interface WebActivityEvent {
  type: "pageview" | "event"
  name?: string | null
  url?: string | null
}

/** How far back the rolling counters look. */
export const WEB_TRIGGER_WINDOW_DAYS = 7
/**
 * Cap for the urls fetched & classified in JS for highIntentViews7d — the
 * counter is therefore computed over the NEWEST 300 pageviews of the window
 * (an approximation that only matters for whale visitors; the flagship
 * template's threshold is 2). pageViews7d is an exact SQL count.
 */
const COUNTER_URL_CAP = 300

/**
 * After a batch actually MATCHES at least one rule, further web_activity
 * evaluations for the same contact are suppressed for this long — a browsing
 * spree is one signal, not a task per flush. In-memory (prod runs a single
 * PM2 process; worst case после рестарта — one extra fire).
 */
export const WEB_TRIGGER_COOLDOWN_MS = 6 * 60 * 60 * 1000
const lastMatched = new Map<string, number>()

function underCooldown(key: string, now: number): boolean {
  const ts = lastMatched.get(key)
  return ts !== undefined && now - ts < WEB_TRIGGER_COOLDOWN_MS
}

function pruneCooldowns(now: number) {
  if (lastMatched.size < 5000) return
  for (const [k, ts] of lastMatched) {
    if (now - ts >= WEB_TRIGGER_COOLDOWN_MS) lastMatched.delete(k)
  }
}

type TriggerClient = Pick<PrismaClient, "contact" | "webAction" | "workflowRule">

/**
 * Build the trigger entity and run matching workflow rules. No-op when the
 * batch is empty, the org has no web_activity rules (the common case — gated
 * FIRST so anonymous-heavy ingest stays cheap), the contact is under the
 * post-match cooldown, or the contact has vanished. Never throws — workflow
 * execution must not disturb the ingest path.
 */
export async function fireWebActivityWorkflows(
  client: TriggerClient,
  args: {
    organizationId: string
    contactId: string
    events: readonly WebActivityEvent[]
    now?: Date
  },
): Promise<void> {
  const { organizationId, contactId, events } = args
  if (events.length === 0) return

  const nowMs = (args.now ?? new Date()).getTime()
  const cooldownKey = `${organizationId}:${contactId}`
  if (underCooldown(cooldownKey, nowMs)) return

  try {
    // Cheapest gate first: no active web_activity rules → nothing to do.
    const ruleCount = await client.workflowRule.count({
      where: {
        organizationId,
        entityType: { in: ["contact", "contacts"] },
        triggerEvent: "web_activity",
        isActive: true,
      },
    })
    if (ruleCount === 0) return

    const contact = await client.contact.findFirst({
      where: { id: contactId, organizationId },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        lifecycleStage: true,
        category: true,
        source: true,
        tags: true,
        companyId: true,
      },
    })
    if (!contact) return

    const pageviews = events.filter((e) => e.type === "pageview")
    const firstEvent = events.find((e) => e.type === "event")
    const hotPage = pageviews.find((e) => classifyPageUrl(e.url) === "page_view_high_intent")

    const windowStart = new Date(nowMs - WEB_TRIGGER_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    const counterWhere = {
      organizationId,
      type: "pageview",
      createdAt: { gte: windowStart },
      session: { contactId },
    }
    // pageViews7d is an exact count; high-intent needs the JS classifier, so
    // it runs over the newest COUNTER_URL_CAP urls (see the cap's doc).
    const [pageViews7d, recent] = await Promise.all([
      client.webAction.count({ where: counterWhere }),
      client.webAction.findMany({
        where: counterWhere,
        select: { url: true },
        take: COUNTER_URL_CAP,
        orderBy: { createdAt: "desc" },
      }),
    ])
    const highIntentViews7d = recent.filter(
      (a: (typeof recent)[number]) => classifyPageUrl(a.url) === "page_view_high_intent",
    ).length

    const matched = await executeWorkflows(organizationId, "contact", "web_activity", {
      ...contact,
      // web context of THIS batch
      pageUrl: (hotPage ?? pageviews[0])?.url ?? null,
      eventName: firstEvent?.name ?? null,
      isHighIntent: !!hotPage,
      batchPageViews: pageviews.length,
      // rolling window counters
      pageViews7d,
      highIntentViews7d,
    })

    // Cooldown starts only when something actually matched — an evaluation
    // that fired nothing must not suppress the batch that finally crosses a
    // rule's threshold minutes later.
    if (matched > 0) {
      lastMatched.set(cooldownKey, nowMs)
      pruneCooldowns(nowMs)
    }
  } catch (err) {
    console.error("[web-tracking-triggers] error:", err instanceof Error ? err.message : "unknown")
  }
}
