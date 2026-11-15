/**
 * The training run (cron `/api/cron/inbox-learning`, every five minutes in the jobs process).
 *
 * For every channel in training («Обучение» in «Кто отвечает на каждом канале»):
 *
 *  1. Each answer a person gave (lib/inbox/learning/model isPersonAnswer), in the order they were
 *     given, gets one sample. Every second question (owner 2026-11-15, «через один») the AI answers it
 *     silently — the live reply code with a `shadow` history (lib/social/ai-autoreply) — and the cheap
 *     model compares that draft with what the person said. Nothing is ever sent to the customer.
 *  2. A conversation quiet for a while is read for knowledge — after its answers were compared, so a
 *     draft is never helped by the answer it is judged against.
 *  3. Every few answers the channel's character is re-read from its people's latest answers.
 *
 * Money is bounded three ways: the organization's daily AI budget (checked before every model call),
 * a cap per run, and a cap per day of silent drafts per organization.
 */
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { checkAiBudget } from "@/lib/ai/budget"
import { generateChannelAiReply } from "@/lib/social/ai-autoreply"
import { LEARNING_REPLY_MODE } from "@/lib/inbox/reply-mode"
import {
  LEARNING_BACKFILL_DAYS, TRAIT_TYPES, answerText, answerTurn, isPersonAnswer, shouldDraft,
  type SampleVerdict, type ThreadMessage,
} from "@/lib/inbox/learning/model"
import { compareAnswers, extractCharacter, extractKnowledge, measuredCharacter } from "@/lib/inbox/learning/judge"
import { planMerge } from "@/lib/inbox/learning/merge"
import { readLearningStart } from "@/lib/inbox/learning/settings"

/** A person's turn may come in several messages; read it once they stopped typing. */
const SETTLE_MS = 2 * 60_000
/** A conversation is read for knowledge once nothing was written in it for this long. */
const QUIET_MS = 15 * 60_000
const CANDIDATES_PER_RUN = 60
const DRAFTS_PER_CHANNEL_PER_RUN = 12
const DRAFTS_PER_ORG_PER_DAY = 300
const EXTRACTIONS_PER_CHANNEL_PER_RUN = 6
const THREAD_MESSAGES = 40
/** Follow-up messages of the same person counted as one answer. */
const ANSWER_TAIL_MS = 10 * 60_000
/** New answers between two readings of a channel's character. */
const CHARACTER_EVERY = 10
const CHARACTER_FIRST_AFTER = 4

export type LearningRunSummary = {
  channels: number
  samples: number
  drafts: number
  extracted: number
  character: number
  stopped: string[]
}

type Channel = { id: string; organizationId: string; channelType: string; settings: unknown }

export async function runInboxLearning(options: { now?: Date } = {}): Promise<LearningRunSummary> {
  const now = options.now ?? new Date()
  const channels: Channel[] = await runWithRlsBypass(() => prisma.channelConfig.findMany({
    where: { settings: { path: ["replyMode"], equals: LEARNING_REPLY_MODE } },
    select: { id: true, organizationId: true, channelType: true, settings: true },
    orderBy: { id: "asc" },
  }))
  const summary: LearningRunSummary = { channels: channels.length, samples: 0, drafts: 0, extracted: 0, character: 0, stopped: [] }
  const draftsToday = new Map<string, number>()
  for (const channel of channels) {
    let stopped: string | null = null
    try {
      await runWithTenant(channel.organizationId, () => learnChannel(channel, now, summary, draftsToday))
      stopped = summary.stopped.find((s) => s.startsWith(`${channel.id}:`))?.slice(channel.id.length + 1) ?? null
    } catch (error) {
      console.error("[inbox-learning]", channel.id, error instanceof Error ? error.message : error)
      summary.stopped.push(`${channel.id}:error`)
      stopped = "error"
    }
    await runWithTenant(channel.organizationId, () => markRun(channel, now, stopped)).catch((error: unknown) => {
      console.error("[inbox-learning mark]", channel.id, error instanceof Error ? error.message : error)
    })
  }
  return summary
}

/**
 * When training last went over a channel, and what stopped it — for «Ход обучения» on the screen.
 * One key of the channel's settings, set in place: a run lasts minutes, and writing back settings it
 * read at the start would undo whatever an admin changed meanwhile (the reply mode itself).
 * The time is the run's own, as an ISO string: the database's clock runs in Europe/Berlin.
 */
async function markRun(channel: Channel, now: Date, stopped: string | null) {
  const run = JSON.stringify({ at: now.toISOString(), stopped })
  await prisma.$executeRaw`
    UPDATE "channel_configs"
       SET "settings" = jsonb_set(COALESCE("settings", '{}'::jsonb), '{learningRun}', ${run}::jsonb, true)
     WHERE "id" = ${channel.id} AND "organizationId" = ${channel.organizationId}`
}

async function budgetAllows(organizationId: string): Promise<boolean> {
  try {
    return (await checkAiBudget(organizationId)).allowed
  } catch {
    return false
  }
}

async function draftsUsedToday(organizationId: string, now: Date, cache: Map<string, number>): Promise<number> {
  const cached = cache.get(organizationId)
  if (cached !== undefined) return cached
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const used = await prisma.aiInteractionLog.count({
    where: { organizationId, agentType: "inbox_learning", createdAt: { gte: dayStart } },
  })
  cache.set(organizationId, used)
  return used
}

function threadOf(rows: Array<ThreadMessage>): ThreadMessage[] {
  return [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
}

async function learnChannel(channel: Channel, now: Date, summary: LearningRunSummary, draftsToday: Map<string, number>) {
  const organizationId = channel.organizationId
  const started = readLearningStart(channel.settings) ?? now
  const since = new Date(Math.max(started.getTime() - LEARNING_BACKFILL_DAYS * 86_400_000, now.getTime() - 21 * 86_400_000))

  // ── 1. answers → samples, in the order they were given ──────────────────────────────────────────
  const last = await prisma.inboxLearningSample.findFirst({
    where: { organizationId, channelConfigId: channel.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { createdAt: true },
  })
  const from = last && last.createdAt > since ? last.createdAt : since
  const outbound = await prisma.channelMessage.findMany({
    where: {
      organizationId,
      direction: "outbound",
      createdAt: { gte: from, lte: new Date(now.getTime() - SETTLE_MS) },
      conversation: { channelConfigId: channel.id },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, conversationId: true, direction: true, body: true, metadata: true, createdAt: true },
    take: CANDIDATES_PER_RUN * 3,
  })
  const answers = outbound.filter((m: ThreadMessage & { conversationId: string | null }) => m.conversationId && isPersonAnswer(m))
  const known = new Set(
    (await prisma.inboxLearningSample.findMany({
      where: { organizationId, answerMessageId: { in: answers.map((a: { id: string }) => a.id) } },
      select: { answerMessageId: true },
    })).map((s: { answerMessageId: string }) => s.answerMessageId),
  )
  let draftsThisRun = 0
  let stop: string | null = null
  for (const answer of answers.filter((a: { id: string }) => !known.has(a.id)).slice(0, CANDIDATES_PER_RUN)) {
    const conversationId = answer.conversationId as string
    // The conversation up to the answer, plus a few minutes after it: a person often answers in
    // several messages, and the comparison should see all of them.
    const thread = threadOf(await prisma.channelMessage.findMany({
      where: { organizationId, conversationId, createdAt: { lte: new Date(answer.createdAt.getTime() + ANSWER_TAIL_MS) } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: THREAD_MESSAGES,
      select: { id: true, direction: true, body: true, metadata: true, createdAt: true },
    }))
    const turn = answerTurn(thread, answer.id)
    const base = { organizationId, channelConfigId: channel.id, conversationId, answerMessageId: answer.id, createdAt: answer.createdAt }
    if (!turn) {
      await saveSample({ ...base, verdict: "no_question" })
      summary.samples++
      continue
    }
    const previous = await prisma.inboxLearningSample.findFirst({
      where: { organizationId, channelConfigId: channel.id, verdict: { not: "no_question" } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { verdict: true },
    })
    if (!shouldDraft(previous?.verdict as SampleVerdict | undefined)) {
      await saveSample({ ...base, questionMessageId: turn.questionMessageId, verdict: "skipped" })
      summary.samples++
      continue
    }
    // A draft costs money: stop for this run rather than skip it — the next run takes it up.
    if (draftsThisRun >= DRAFTS_PER_CHANNEL_PER_RUN) { stop = "run_cap"; break }
    if ((await draftsUsedToday(organizationId, now, draftsToday)) >= DRAFTS_PER_ORG_PER_DAY) { stop = "day_cap"; break }
    if (!(await budgetAllows(organizationId))) { stop = "budget"; break }

    const conversation = await prisma.socialConversation.findFirst({
      where: { id: conversationId, organizationId },
      select: { id: true, platform: true, externalId: true, contactName: true, contactId: true },
    })
    if (!conversation) continue
    const ai = await generateChannelAiReply({
      orgId: organizationId,
      channel: conversation.platform,
      externalId: conversation.externalId,
      userMessage: turn.question,
      senderName: conversation.contactName || conversation.externalId,
      contactId: conversation.contactId,
      conversationId,
      channelConfigId: channel.id,
      shadow: { history: turn.history, asOf: answer.createdAt },
    })
    draftsThisRun++
    draftsToday.set(organizationId, (draftsToday.get(organizationId) ?? 0) + 1)
    summary.drafts++
    if (!ai.reply) {
      if (ai.skipped === "budget" || ai.skipped === "budget_unavailable" || ai.skipped === "no_api_key") { stop = ai.skipped; break }
      // An attack in the conversation: live, the AI would stay silent and a person would answer.
      const verdict: SampleVerdict = ai.skipped === "prompt_attack" ? "handoff" : "failed"
      await saveSample({ ...base, questionMessageId: turn.questionMessageId, verdict, reason: verdict === "handoff" ? "other" : null, draftLogId: ai.logId ?? null })
      summary.samples++
      continue
    }
    const comparison = await compareAnswers({
      organizationId, question: turn.question, personAnswer: answerText(thread, answer.id), aiAnswer: ai.reply, aiHandedOff: ai.escalate,
    })
    let reason = comparison?.reason ?? null
    if (comparison && ai.guardForcedHandoff && comparison.verdict !== "same" && comparison.verdict !== "almost") {
      // The price rule held the AI back: say so when it was a price nobody has confirmed yet.
      const waiting = await prisma.inboxLearnedItem.count({
        where: { organizationId, channelConfigId: channel.id, kind: "knowledge", removedAt: null, status: { in: ["pending", "conflict"] } },
      })
      reason = waiting > 0 ? "pending_price" : reason ?? "no_knowledge"
    }
    await saveSample({
      ...base,
      questionMessageId: turn.questionMessageId,
      verdict: comparison?.verdict ?? "failed",
      topic: comparison?.topic ?? null,
      reason,
      draftLogId: ai.logId ?? null,
    })
    summary.samples++
  }
  if (stop) summary.stopped.push(`${channel.id}:${stop}`)

  // ── 2. quiet conversations → knowledge ────────────────────────────────────────────────────────
  const pending = await prisma.inboxLearningSample.findMany({
    where: { organizationId, channelConfigId: channel.id, extractedAt: null },
    select: { conversationId: true },
    distinct: ["conversationId"],
    take: 50,
  })
  const quiet = pending.length
    ? await prisma.socialConversation.findMany({
        where: {
          organizationId,
          id: { in: pending.map((p: { conversationId: string }) => p.conversationId) },
          lastMessageAt: { lte: new Date(now.getTime() - QUIET_MS) },
        },
        select: { id: true, contactName: true },
        orderBy: { lastMessageAt: "asc" },
        take: EXTRACTIONS_PER_CHANNEL_PER_RUN,
      })
    : []
  for (const conversation of quiet) {
    if (!(await budgetAllows(organizationId))) { summary.stopped.push(`${channel.id}:budget`); break }
    const thread = threadOf(await prisma.channelMessage.findMany({
      where: { organizationId, conversationId: conversation.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: THREAD_MESSAGES,
      select: { id: true, direction: true, body: true, metadata: true, createdAt: true },
    }))
    const lines = thread
      .filter((m) => (m.body ?? "").trim())
      .map((m) => ({ id: m.id, who: m.direction === "inbound" ? "customer" as const : isPersonAnswer(m) ? "person" as const : "other" as const, text: m.body ?? "" }))
    const existing = await prisma.inboxLearnedItem.findMany({
      where: { organizationId, channelConfigId: channel.id, kind: "knowledge" },
      orderBy: { lastSeenAt: "desc" },
      take: 200,
      select: { id: true, type: true, title: true, body: true, status: true, alternatives: true, removedAt: true, editedAt: true, seenCount: true },
    })
    const facts = lines.some((l) => l.who === "person")
      ? await extractKnowledge({
          organizationId,
          lines,
          known: existing.filter((e: { removedAt: Date | null }) => !e.removedAt).slice(0, 80),
          knownNames: conversation.contactName ? [conversation.contactName] : [],
        })
      : []
    if (facts === null) { summary.stopped.push(`${channel.id}:extract_failed`); break }
    const ops = planMerge(existing, facts, now)
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      for (const op of ops) {
        if (op.op === "create") {
          const line = op.messageIndex && op.messageIndex >= 1 ? lines[op.messageIndex - 1] : undefined
          const source = line?.who === "person" ? line.id : lines.filter((l) => l.who === "person").at(-1)?.id ?? null
          await tx.inboxLearnedItem.create({
            data: {
              organizationId, channelConfigId: channel.id, kind: "knowledge", type: op.type, title: op.title, body: op.body,
              status: op.status, source: "learned", seenCount: 1, lastSeenAt: now,
              sourceConversationId: conversation.id, sourceMessageId: source,
            },
          })
        } else if (op.op === "seen") {
          await tx.inboxLearnedItem.updateMany({
            where: { id: op.id, organizationId },
            data: { seenCount: { increment: 1 }, lastSeenAt: now },
          })
        } else if (op.op === "update") {
          await tx.inboxLearnedItem.updateMany({
            where: { id: op.id, organizationId, editedAt: null },
            data: { body: op.body, status: op.status, seenCount: { increment: 1 }, lastSeenAt: now, sourceConversationId: conversation.id },
          })
        } else {
          await tx.inboxLearnedItem.updateMany({
            where: { id: op.id, organizationId },
            data: { status: "conflict", alternatives: op.alternatives, seenCount: { increment: 1 }, lastSeenAt: now, sourceConversationId: conversation.id },
          })
        }
      }
      await tx.inboxLearningSample.updateMany({
        where: { organizationId, channelConfigId: channel.id, conversationId: conversation.id, extractedAt: null },
        data: { extractedAt: now },
      })
    })
    summary.extracted++
  }

  // ── 3. character ──────────────────────────────────────────────────────────────────────────────
  const traits = await prisma.inboxLearnedItem.findMany({
    where: { organizationId, channelConfigId: channel.id, kind: "trait" },
    select: { id: true, type: true, editedAt: true, removedAt: true, updatedAt: true, source: true },
  })
  const learnedAt = traits
    .filter((t: { source: string }) => t.source === "learned")
    .reduce((max: Date | null, t: { updatedAt: Date }) => (!max || t.updatedAt > max ? t.updatedAt : max), null as Date | null)
  const fresh = await prisma.inboxLearningSample.count({
    where: { organizationId, channelConfigId: channel.id, ...(learnedAt ? { createdAt: { gt: learnedAt } } : {}) },
  })
  if (fresh < (learnedAt ? CHARACTER_EVERY : CHARACTER_FIRST_AFTER)) return
  if (!(await budgetAllows(organizationId))) { summary.stopped.push(`${channel.id}:budget`); return }
  const recent = await prisma.inboxLearningSample.findMany({
    where: { organizationId, channelConfigId: channel.id },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { answerMessageId: true },
  })
  const bodies = (await prisma.channelMessage.findMany({
    where: { organizationId, id: { in: recent.map((r: { answerMessageId: string }) => r.answerMessageId) } },
    select: { body: true },
  })).map((m: { body: string }) => m.body).filter((b: string) => b && b.trim())
  if (bodies.length === 0) return
  const measured = measuredCharacter(bodies)
  const read = await extractCharacter({ organizationId, answers: bodies })
  const next: Partial<Record<string, string>> = { ...(read ?? {}), ...(measured ?? {}) }
  const TITLES: Record<string, string> = {
    tone: "Тон", address: "Обращение", length: "Длина ответа", language: "Язык", emoji: "Эмодзи", phrases: "Типичные фразы", avoid: "Чего не делает",
  }
  for (const type of TRAIT_TYPES) {
    const body = next[type]
    if (!body) continue
    const current = traits.find((t: { type: string }) => t.type === type)
    if (current?.editedAt || current?.removedAt) continue
    if (current) {
      await prisma.inboxLearnedItem.updateMany({ where: { id: current.id, organizationId }, data: { body, lastSeenAt: now } })
    } else {
      await prisma.inboxLearnedItem.create({
        data: { organizationId, channelConfigId: channel.id, kind: "trait", type, title: TITLES[type], body, status: "active", source: "learned", seenCount: bodies.length, lastSeenAt: now },
      })
    }
  }
  summary.character++
}

async function saveSample(data: {
  organizationId: string
  channelConfigId: string
  conversationId: string
  answerMessageId: string
  createdAt: Date
  questionMessageId?: string | null
  verdict: SampleVerdict
  topic?: string | null
  reason?: string | null
  draftLogId?: string | null
}) {
  // One sample per answer: an overlapping run that got here first wins, this one moves on.
  await prisma.inboxLearningSample.create({ data }).catch((error: unknown) => {
    if ((error as { code?: string })?.code !== "P2002") throw error
  })
}
