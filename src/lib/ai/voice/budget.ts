/**
 * Minute budget — reserve up-front, settle on a confirmed end.
 *
 * We cannot stop a running browser WebRTC conversation from our side, so the
 * budget cannot be "count what was used": a session that dies with the tab
 * would then cost nothing and could be restarted forever. Instead the full
 * session ceiling is reserved at mint time and only the unused remainder is
 * returned when the client confirms it ended. A session that simply vanishes
 * keeps its whole reservation — the conservative direction.
 *
 * checkRateLimit cannot serve this purpose: it is per-process, in-memory, and
 * every deploy zeroes it. It stays useful only as burst protection.
 *
 * All writes go through the caller's tenant scope (withRlsAuth), which matters:
 * voice_monthly_usage is RLS-FORCED, so an UPDATE outside the scope would match
 * zero rows and silently look like success.
 */
import { prisma } from "@/lib/prisma"
import { journalAiCallOnCurrentKey } from "@/lib/ai/gateway/access"
import { LIVE_AUDIO_IN_MINUTE_USD, liveUsageCostUsd, perMinuteCostUsd, UNIT_PRICING } from "@/lib/ai/gateway/pricing"
import type { LiveUsageTotals } from "./live-usage"
import { yearMonthKey } from "./config"
import { monthlyBudgetSeconds } from "./monthly-budget"

export type ReservationResult =
  | { ok: true; remainingSeconds: number }
  | { ok: false; reason: "budget_exhausted"; remainingSeconds: number }

/**
 * Atomically claim `seconds` of this month's budget.
 *
 * The guard lives in the UPDATE's WHERE, not in a preceding SELECT: two tabs
 * starting a conversation at once must not both pass a read-then-write check.
 */
export async function reserveVoiceSeconds(
  organizationId: string,
  userId: string,
  seconds: number,
  now: Date,
): Promise<ReservationResult> {
  const yearMonth = yearMonthKey(now)
  // Resolved per organisation, so one customer's ceiling can be raised without
  // a release and without touching anyone else's.
  const budgetSeconds = await monthlyBudgetSeconds(organizationId)

  // Upsert the month row first so the guarded UPDATE below always has a target.
  await prisma.voiceMonthlyUsage.upsert({
    where: { organizationId_userId_yearMonth: { organizationId, userId, yearMonth } },
    create: { organizationId, userId, yearMonth, reservedSeconds: 0, settledSeconds: 0 },
    update: {},
  })

  const claimed = await prisma.voiceMonthlyUsage.updateMany({
    where: {
      organizationId,
      userId,
      yearMonth,
      reservedSeconds: { lte: budgetSeconds - seconds },
    },
    data: { reservedSeconds: { increment: seconds } },
  })

  const row = await prisma.voiceMonthlyUsage.findFirst({
    where: { organizationId, userId, yearMonth },
    select: { reservedSeconds: true },
  })
  const used = row?.reservedSeconds ?? 0
  const remaining = Math.max(0, budgetSeconds - used)

  if (claimed.count !== 1) {
    return { ok: false, reason: "budget_exhausted", remainingSeconds: remaining }
  }
  return { ok: true, remainingSeconds: remaining }
}

/**
 * Return the unused part of a reservation once a session is confirmed over.
 * `billedSeconds` is what the conversation actually consumed.
 */
export async function settleVoiceSeconds(
  organizationId: string,
  userId: string,
  reservedSeconds: number,
  billedSeconds: number,
  now: Date,
  /** What Google counted for the conversation, as the console added it up; absent — priced by length. */
  liveUsage?: LiveUsageTotals | null,
): Promise<void> {
  const refund = Math.max(0, reservedSeconds - Math.max(0, billedSeconds))
  const yearMonth = yearMonthKey(now)

  await prisma.voiceMonthlyUsage.updateMany({
    where: { organizationId, userId, yearMonth },
    data: {
      // Never let a refund drive the counter below what was actually spent.
      reservedSeconds: { decrement: refund },
      settledSeconds: { increment: Math.max(0, billedSeconds) },
    },
  })
  // The organization's AI journal (src/lib/ai/gateway): what the conversation
  // cost. With the console's token totals — Google's own count, every turn
  // billing the whole context again; the incoming audio of the billed seconds
  // is the floor, so a console that reports less than that cannot make a
  // conversation cheaper than its sound. Without them (a closed tab, the
  // reaper) — the per-minute estimate.
  if (billedSeconds > 0) {
    const byTokens = liveUsage
      ? Math.max(liveUsageCostUsd(liveUsage), perMinuteCostUsd(LIVE_AUDIO_IN_MINUTE_USD, billedSeconds))
      : null
    await journalAiCallOnCurrentKey(organizationId, "gemini", "voice-assistant", {
      model: "gemini-live",
      ...(liveUsage ? {
        inputTokens: liveUsage.textIn + liveUsage.audioIn,
        outputTokens: liveUsage.textOut + liveUsage.audioOut,
      } : {}),
      costUsd: byTokens ?? perMinuteCostUsd(UNIT_PRICING.geminiLiveMinute, billedSeconds),
    })
  }
}
