/**
 * What the «Обучение ИИ» screen reads and changes (api/v1/settings/inbox-learning) and what the inbox
 * thread shows under a person's answer (api/v1/inbox/conversations/[id]/learning). Every call is
 * scoped to one organization, inside the caller's RLS context.
 */
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { aiReplyEnabled, LEARNING_REPLY_MODE } from "@/lib/inbox/reply-mode"
import { isDedicatedChannelType } from "@/lib/channels/dedicated-channel-types"
import {
  COMPARED_VERDICTS, KNOWLEDGE_TYPES, LEARNING_BACKFILL_DAYS, READINESS_MIN_QUESTIONS, TRAIT_TYPES, answerText,
  computeReadiness, effectiveVerdict, isPersonAnswer,
  type Readiness, type ThreadMessage,
} from "@/lib/inbox/learning/model"
import { needsConfirmation, readAlternatives } from "@/lib/inbox/learning/merge"
import { readLearningRun, readLearningStart } from "@/lib/inbox/learning/settings"

/** The channel types whose webhooks honour the reply mode — the only ones training can run on. */
export const LEARNING_CHANNEL_TYPES = ["instagram", "facebook", "whatsapp", "telegram", "vkontakte", "chatwoot"] as const
const DIFFERENCES_SHOWN = 20
const SAMPLES_READ = 400

export type ChannelMode = "learning" | "human" | "draft" | "ai"

export function channelMode(settings: unknown, channelType: string): ChannelMode {
  const s = (settings && typeof settings === "object" ? settings : {}) as Record<string, unknown>
  const raw = typeof s.replyMode === "string" ? s.replyMode : undefined
  if (raw === LEARNING_REPLY_MODE) return "learning"
  if (!aiReplyEnabled(raw, channelType === "whatsapp")) return "human"
  return s.draftMode === true ? "draft" : "ai"
}

async function samplesOf(organizationId: string, channelConfigId: string) {
  return prisma.inboxLearningSample.findMany({
    where: { organizationId, channelConfigId, verdict: { in: [...COMPARED_VERDICTS] } },
    orderBy: { createdAt: "desc" },
    take: SAMPLES_READ,
    select: { id: true, verdict: true, resolution: true, topic: true, reason: true, createdAt: true, conversationId: true, answerMessageId: true, questionMessageId: true, draftLogId: true },
  })
}

export type ChannelSummary = {
  id: string
  channelType: string
  name: string
  mode: ChannelMode
  startedAt: string | null
  readiness: Pick<Readiness, "compared" | "percent" | "topicPercent" | "topicsKnown"> & { topicsTotal: number }
  waiting: number
  knowledge: number
}

export async function listLearningChannels(organizationId: string): Promise<ChannelSummary[]> {
  const channels = await prisma.channelConfig.findMany({
    where: { organizationId, channelType: { in: [...LEARNING_CHANNEL_TYPES] } },
    select: { id: true, channelType: true, configName: true, displayName: true, settings: true, isActive: true },
    orderBy: [{ channelType: "asc" }, { configName: "asc" }],
  })
  const out: ChannelSummary[] = []
  for (const c of channels.filter((row: { channelType: string }) => !isDedicatedChannelType(row.channelType))) {
    const [samples, items] = await Promise.all([
      samplesOf(organizationId, c.id),
      prisma.inboxLearnedItem.findMany({
        where: { organizationId, channelConfigId: c.id, kind: "knowledge", removedAt: null },
        select: { status: true },
      }),
    ])
    const r = computeReadiness(samples)
    out.push({
      id: c.id,
      channelType: c.channelType,
      name: channelName(c),
      mode: channelMode(c.settings, c.channelType),
      startedAt: readLearningStart(c.settings)?.toISOString() ?? null,
      readiness: { compared: r.compared, percent: r.percent, topicPercent: r.topicPercent, topicsKnown: r.topicsKnown, topicsTotal: r.topics.length },
      waiting: items.filter((i: { status: string }) => i.status !== "active").length,
      knowledge: items.filter((i: { status: string }) => i.status === "active").length,
    })
  }
  return out
}

function channelName(c: { configName: string; displayName?: string | null; settings: unknown }): string {
  const s = (c.settings && typeof c.settings === "object" ? c.settings : {}) as Record<string, unknown>
  const username = typeof s.username === "string" && s.username.trim() ? `@${s.username.trim().replace(/^@/, "")}` : ""
  return username || c.displayName?.trim() || c.configName
}

export type LearnedItemView = {
  id: string
  kind: "knowledge" | "trait"
  type: string
  title: string
  body: string
  status: string
  alternatives: Array<{ body: string; seen: number; lastSeenAt: string }>
  source: string
  seenCount: number
  lastSeenAt: string
  edited: boolean
  approvedAt: string | null
  from: { conversationId: string; messageId: string | null; name: string } | null
}

export type DifferenceView = {
  id: string
  verdict: string
  reason: string | null
  topic: string | null
  question: string
  personAnswer: string
  aiAnswer: string
  conversationId: string
  answerMessageId: string
  contactName: string
  at: string
}

/**
 * «Ход обучения» (owner 2026-11-15, looking at a fresh channel showing 0 everywhere: «сделай так,
 * чтоб как-то показывался прогресс обучения»): what training found on the channel since it started
 * reading, what it has read so far, and when it last went over the channel.
 */
export type LearningProgress = {
  since: string | null
  answersTotal: number
  answersRead: number
  conversationsTotal: number
  conversationsRead: number
  compared: number
  minQuestions: number
  lastRunAt: string | null
  stopped: string | null
  state: "waiting_first_run" | "nothing_found" | "reading" | "listening"
}

export type ChannelDetail = {
  channel: ChannelSummary
  readiness: Readiness
  progress: LearningProgress
  differences: DifferenceView[]
  items: LearnedItemView[]
  conversations: number
}

/** How many of a channel's people's answers a progress count reads at most. */
const PROGRESS_ANSWERS_READ = 5000

export async function learningProgress(organizationId: string, channel: { id: string; settings: unknown }, compared: number, now = new Date()): Promise<LearningProgress> {
  const started = readLearningStart(channel.settings)
  const run = readLearningRun(channel.settings)
  const since = started ? new Date(Math.max(started.getTime() - LEARNING_BACKFILL_DAYS * 86_400_000, now.getTime() - 21 * 86_400_000)) : null
  let answersTotal = 0
  let answersRead = 0
  let conversationsTotal = 0
  let conversationsRead = 0
  if (since) {
    const [outbound, samples] = await Promise.all([
      prisma.channelMessage.findMany({
        where: { organizationId, direction: "outbound", createdAt: { gte: since }, conversation: { channelConfigId: channel.id } },
        select: { id: true, conversationId: true, direction: true, body: true, metadata: true },
        orderBy: { createdAt: "desc" },
        take: PROGRESS_ANSWERS_READ,
      }),
      prisma.inboxLearningSample.findMany({
        where: { organizationId, channelConfigId: channel.id, createdAt: { gte: since } },
        select: { answerMessageId: true, conversationId: true, extractedAt: true },
      }),
    ])
    const answers = outbound.filter((m: { direction: string; body: string; metadata: unknown; conversationId: string | null }) => m.conversationId && isPersonAnswer(m))
    const read = new Set(samples.map((s: { answerMessageId: string }) => s.answerMessageId))
    answersTotal = answers.length
    answersRead = answers.filter((a: { id: string }) => read.has(a.id)).length
    conversationsTotal = new Set(answers.map((a: { conversationId: string | null }) => a.conversationId)).size
    conversationsRead = new Set(
      samples.filter((s: { extractedAt: Date | null }) => s.extractedAt).map((s: { conversationId: string }) => s.conversationId),
    ).size
  }
  const ranSinceStart = Boolean(run && (!started || run.at >= started))
  const state: LearningProgress["state"] = !ranSinceStart
    ? "waiting_first_run"
    : answersTotal === 0
      ? "nothing_found"
      : answersRead < answersTotal || conversationsRead < conversationsTotal
        ? "reading"
        : "listening"
  return {
    since: since?.toISOString() ?? null,
    answersTotal,
    answersRead,
    conversationsTotal,
    conversationsRead: Math.min(conversationsRead, conversationsTotal),
    compared,
    minQuestions: READINESS_MIN_QUESTIONS,
    lastRunAt: run?.at.toISOString() ?? null,
    stopped: run?.stopped ?? null,
    state,
  }
}

export async function channelLearningDetail(organizationId: string, channelConfigId: string): Promise<ChannelDetail | null> {
  const summary = (await listLearningChannels(organizationId)).find((c) => c.id === channelConfigId)
  if (!summary) return null
  const samples = await samplesOf(organizationId, channelConfigId)
  const readiness = computeReadiness(samples)
  const channelRow = await prisma.channelConfig.findFirst({ where: { id: channelConfigId, organizationId }, select: { id: true, settings: true } })
  const progress = await learningProgress(organizationId, { id: channelConfigId, settings: channelRow?.settings ?? null }, readiness.compared)

  const open = samples
    .filter((s: { verdict: string; resolution: string | null }) => (s.verdict === "different" || s.verdict === "handoff") && !s.resolution)
    .slice(0, DIFFERENCES_SHOWN)
  const messageIds = open.flatMap((s: { answerMessageId: string; questionMessageId: string | null }) => [s.answerMessageId, s.questionMessageId].filter(Boolean) as string[])
  const [messages, logs, conversations, rows, readConversations] = await Promise.all([
    prisma.channelMessage.findMany({ where: { organizationId, id: { in: messageIds } }, select: { id: true, body: true, conversationId: true, createdAt: true } }),
    prisma.aiInteractionLog.findMany({
      where: { organizationId, id: { in: open.map((s: { draftLogId: string | null }) => s.draftLogId).filter(Boolean) as string[] } },
      select: { id: true, aiResponse: true },
    }),
    prisma.socialConversation.findMany({
      where: { organizationId, id: { in: open.map((s: { conversationId: string }) => s.conversationId) } },
      select: { id: true, contactName: true },
    }),
    prisma.inboxLearnedItem.findMany({
      where: { organizationId, channelConfigId, removedAt: null },
      orderBy: [{ kind: "asc" }, { lastSeenAt: "desc" }],
    }),
    prisma.inboxLearningSample.findMany({
      where: { organizationId, channelConfigId, extractedAt: { not: null } },
      select: { conversationId: true },
      distinct: ["conversationId"],
    }),
  ])
  const byId = new Map(messages.map((m: { id: string; body: string; createdAt: Date }) => [m.id, m] as const))
  const logById = new Map(logs.map((l: { id: string; aiResponse: string }) => [l.id, l.aiResponse] as const))
  const nameOf = new Map(conversations.map((c: { id: string; contactName: string }) => [c.id, c.contactName] as const))

  // The person's whole answer may run over several messages; read the thread around each.
  const differences: DifferenceView[] = []
  for (const s of open) {
    const answer = byId.get(s.answerMessageId) as { id: string; body: string; createdAt: Date } | undefined
    if (!answer) continue
    const tail: ThreadMessage[] = await prisma.channelMessage.findMany({
      where: { organizationId, conversationId: s.conversationId, createdAt: { gte: answer.createdAt, lte: new Date(answer.createdAt.getTime() + 10 * 60_000) } },
      orderBy: { createdAt: "asc" },
      take: 6,
      select: { id: true, direction: true, body: true, metadata: true, createdAt: true },
    })
    differences.push({
      id: s.id,
      verdict: s.verdict,
      reason: s.reason,
      topic: s.topic,
      question: (s.questionMessageId && (byId.get(s.questionMessageId) as { body?: string } | undefined)?.body) || "",
      personAnswer: answerText(tail, s.answerMessageId) || answer.body,
      aiAnswer: (s.draftLogId && logById.get(s.draftLogId)) || "",
      conversationId: s.conversationId,
      answerMessageId: s.answerMessageId,
      contactName: (nameOf.get(s.conversationId) as string | undefined) || "",
      at: s.createdAt.toISOString(),
    })
  }

  const sourceNames = new Map<string, string>(
    (await prisma.socialConversation.findMany({
      where: { organizationId, id: { in: [...new Set(rows.map((r: { sourceConversationId: string | null }) => r.sourceConversationId).filter(Boolean) as string[])] } },
      select: { id: true, contactName: true },
    })).map((c: { id: string; contactName: string }): [string, string] => [c.id, c.contactName]),
  )
  return {
    channel: summary,
    readiness,
    progress,
    differences,
    items: rows.map((r: Parameters<typeof itemView>[0]) => itemView(r, sourceNames)),
    conversations: readConversations.length,
  }
}

function itemView(row: {
  id: string; kind: string; type: string; title: string; body: string; status: string; alternatives: unknown; source: string
  seenCount: number; lastSeenAt: Date; editedAt: Date | null; approvedAt: Date | null; sourceConversationId: string | null; sourceMessageId: string | null
}, names: Map<string, string>): LearnedItemView {
  return {
    id: row.id,
    kind: row.kind === "trait" ? "trait" : "knowledge",
    type: row.type,
    title: row.title,
    body: row.body,
    status: row.status,
    alternatives: readAlternatives(row.alternatives),
    source: row.source,
    seenCount: row.seenCount,
    lastSeenAt: row.lastSeenAt.toISOString(),
    edited: Boolean(row.editedAt),
    approvedAt: row.approvedAt?.toISOString() ?? null,
    from: row.sourceConversationId
      ? { conversationId: row.sourceConversationId, messageId: row.sourceMessageId, name: names.get(row.sourceConversationId) || "" }
      : null,
  }
}

/* ─────────────── changes a person makes ─────────────── */

export type ItemChange =
  | { action: "edit"; title?: string; body?: string; type?: string }
  | { action: "approve" }
  | { action: "choose"; index: number }
  | { action: "remove" }
  | { action: "restore" }

export type ChangeResult = { ok: true; item: LearnedItemView } | { ok: false; status: number; error: string }

const clean = (value: unknown, max: number) => (typeof value === "string" ? value.trim().replace(/\r\n/g, "\n").slice(0, max) : "")

export async function createItem(params: {
  organizationId: string; channelConfigId: string; userId: string | null; type: unknown; title: unknown; body: unknown
}): Promise<ChangeResult> {
  const channel = await prisma.channelConfig.findFirst({
    where: { id: params.channelConfigId, organizationId: params.organizationId, channelType: { in: [...LEARNING_CHANNEL_TYPES] } },
    select: { id: true },
  })
  if (!channel) return { ok: false, status: 404, error: "channel_not_found" }
  const type = (KNOWLEDGE_TYPES as readonly string[]).includes(params.type as string) ? (params.type as string) : "qa"
  const title = clean(params.title, 120)
  const body = clean(params.body, 800)
  if (!title || !body) return { ok: false, status: 400, error: "title_and_body_required" }
  const now = new Date()
  // A person wrote it: it is the company's word, a price included.
  const row = await prisma.inboxLearnedItem.create({
    data: {
      organizationId: params.organizationId, channelConfigId: channel.id, kind: "knowledge", type, title, body, status: "active",
      source: "manual", seenCount: 0, lastSeenAt: now, editedById: params.userId, editedAt: now,
      ...(needsConfirmation(type, `${title}\n${body}`) ? { approvedById: params.userId, approvedAt: now } : {}),
    },
  })
  return { ok: true, item: itemView(row, new Map()) }
}

export async function changeItem(params: {
  organizationId: string; channelConfigId: string; itemId: string; userId: string | null; change: ItemChange
}): Promise<ChangeResult> {
  const row = await prisma.inboxLearnedItem.findFirst({
    where: { id: params.itemId, organizationId: params.organizationId, channelConfigId: params.channelConfigId },
  })
  if (!row) return { ok: false, status: 404, error: "item_not_found" }
  const now = new Date()
  const change = params.change
  let data: Prisma.InboxLearnedItemUpdateManyMutationInput
  if (change.action === "remove") {
    data = { removedAt: now, editedById: params.userId }
  } else if (change.action === "restore") {
    data = { removedAt: null }
  } else if (change.action === "approve") {
    if (row.kind !== "knowledge" || row.status !== "pending") return { ok: false, status: 409, error: "nothing_to_approve" }
    data = { status: "active", approvedById: params.userId, approvedAt: now }
  } else if (change.action === "choose") {
    const alternatives = readAlternatives(row.alternatives)
    const chosen = alternatives[change.index]
    if (row.status !== "conflict" || !chosen) return { ok: false, status: 409, error: "nothing_to_choose" }
    data = { status: "active", body: chosen.body, alternatives: Prisma.DbNull, approvedById: params.userId, approvedAt: now, editedById: params.userId, editedAt: now }
  } else {
    const title = change.title === undefined ? row.title : clean(change.title, 120)
    const body = change.body === undefined ? row.body : clean(change.body, row.kind === "trait" ? 600 : 800)
    if (!title || !body) return { ok: false, status: 400, error: "title_and_body_required" }
    const type = row.kind === "knowledge" && change.type !== undefined
      ? ((KNOWLEDGE_TYPES as readonly string[]).includes(change.type) ? change.type : row.type)
      : row.type
    if (row.kind === "trait" && !(TRAIT_TYPES as readonly string[]).includes(type)) return { ok: false, status: 400, error: "bad_type" }
    // A person's edit is the company's word: what they saved is what the AI states, a price included.
    data = {
      title, body, type, editedById: params.userId, editedAt: now,
      ...(row.kind === "knowledge" ? { status: "active", alternatives: Prisma.DbNull } : {}),
      ...(row.kind === "knowledge" && needsConfirmation(type, `${title}\n${body}`) ? { approvedById: params.userId, approvedAt: now } : {}),
    }
  }
  await prisma.inboxLearnedItem.updateMany({ where: { id: row.id, organizationId: params.organizationId }, data })
  const saved = await prisma.inboxLearnedItem.findFirst({ where: { id: row.id, organizationId: params.organizationId } })
  return { ok: true, item: itemView(saved!, new Map()) }
}

export type SampleChange = { action: "accept" } | { action: "teach" } | { action: "dismiss" }

export async function changeSample(params: {
  organizationId: string; channelConfigId: string; sampleId: string; userId: string | null; change: SampleChange
}): Promise<{ ok: true; item?: LearnedItemView } | { ok: false; status: number; error: string }> {
  const sample = await prisma.inboxLearningSample.findFirst({
    where: { id: params.sampleId, organizationId: params.organizationId, channelConfigId: params.channelConfigId },
  })
  if (!sample) return { ok: false, status: 404, error: "sample_not_found" }
  if (sample.resolution) return { ok: false, status: 409, error: "already_resolved" }
  const now = new Date()
  let item: LearnedItemView | undefined
  if (params.change.action === "teach") {
    const [question, answer] = await Promise.all([
      sample.questionMessageId
        ? prisma.channelMessage.findFirst({ where: { id: sample.questionMessageId, organizationId: params.organizationId }, select: { body: true } })
        : null,
      prisma.channelMessage.findFirst({ where: { id: sample.answerMessageId, organizationId: params.organizationId }, select: { body: true, createdAt: true } }),
    ])
    if (!answer) return { ok: false, status: 404, error: "answer_not_found" }
    const tail: ThreadMessage[] = await prisma.channelMessage.findMany({
      where: { organizationId: params.organizationId, conversationId: sample.conversationId, createdAt: { gte: answer.createdAt, lte: new Date(answer.createdAt.getTime() + 10 * 60_000) } },
      orderBy: { createdAt: "asc" },
      take: 6,
      select: { id: true, direction: true, body: true, metadata: true, createdAt: true },
    })
    const body = clean(answerText(tail, sample.answerMessageId) || answer.body, 800)
    const title = clean(sample.topic || question?.body || "", 120) || body.slice(0, 60)
    const money = needsConfirmation("qa", `${title}\n${body}`)
    // «Запомнить ответ сотрудника»: what the person said becomes knowledge. A price in it still waits
    // for «Подтвердить» — the button teaches an answer, it does not confirm a price.
    const row = await prisma.inboxLearnedItem.create({
      data: {
        organizationId: params.organizationId, channelConfigId: params.channelConfigId, kind: "knowledge",
        type: money ? "price" : "qa", title, body, status: money ? "pending" : "active", source: "learned",
        seenCount: 1, lastSeenAt: now, sourceConversationId: sample.conversationId, sourceMessageId: sample.answerMessageId,
      },
    })
    item = itemView(row, new Map())
  }
  await prisma.inboxLearningSample.updateMany({
    where: { id: sample.id, organizationId: params.organizationId, resolution: null },
    data: {
      resolution: params.change.action === "teach" ? "taught" : params.change.action === "dismiss" ? "dismissed" : "accepted",
      resolvedById: params.userId,
      resolvedAt: now,
    },
  })
  return { ok: true, item }
}

/* ─────────────── under a person's answer in the thread ─────────────── */

export type ConversationLearning = {
  channelConfigId: string
  mode: ChannelMode
  percent: number | null
  answers: Record<string, { verdict: string; aiAnswer: string | null; sampleId: string }>
  learned: Array<{ id: string; title: string; messageId: string | null }>
}

export async function conversationLearning(organizationId: string, conversationId: string): Promise<ConversationLearning | null> {
  const conversation = await prisma.socialConversation.findFirst({
    where: { id: conversationId, organizationId },
    select: { channelConfigId: true },
  })
  if (!conversation?.channelConfigId) return null
  const channel = await prisma.channelConfig.findFirst({
    where: { id: conversation.channelConfigId, organizationId },
    select: { id: true, channelType: true, settings: true },
  })
  if (!channel) return null
  const mode = channelMode(channel.settings, channel.channelType)
  const [samples, channelSamples, learned] = await Promise.all([
    prisma.inboxLearningSample.findMany({
      // A dismissed answer was no yardstick: the thread does not judge it either.
      where: { organizationId, conversationId, verdict: { in: [...COMPARED_VERDICTS] }, OR: [{ resolution: null }, { resolution: { not: "dismissed" } }] },
      select: { id: true, answerMessageId: true, verdict: true, resolution: true, draftLogId: true },
    }),
    samplesOf(organizationId, channel.id),
    prisma.inboxLearnedItem.findMany({
      where: { organizationId, channelConfigId: channel.id, sourceConversationId: conversationId, removedAt: null, kind: "knowledge" },
      select: { id: true, title: true, sourceMessageId: true },
      take: 30,
    }),
  ])
  if (mode !== "learning" && samples.length === 0 && learned.length === 0) {
    return { channelConfigId: channel.id, mode, percent: null, answers: {}, learned: [] }
  }
  const draftIds = samples
    .filter((s: { verdict: string; resolution: string | null; draftLogId: string | null }) => effectiveVerdict(s) !== "same" && s.draftLogId)
    .map((s: { draftLogId: string | null }) => s.draftLogId as string)
  const logs = await prisma.aiInteractionLog.findMany({ where: { organizationId, id: { in: draftIds } }, select: { id: true, aiResponse: true } })
  const logById = new Map(logs.map((l: { id: string; aiResponse: string }) => [l.id, l.aiResponse] as const))
  const answers: ConversationLearning["answers"] = {}
  for (const s of samples) {
    const verdict = effectiveVerdict(s)
    answers[s.answerMessageId] = {
      verdict,
      sampleId: s.id,
      aiAnswer: verdict === "same" ? null : ((s.draftLogId && logById.get(s.draftLogId)) as string | undefined) ?? null,
    }
  }
  return {
    channelConfigId: channel.id,
    mode,
    percent: computeReadiness(channelSamples).percent,
    answers,
    learned: learned.map((l: { id: string; title: string; sourceMessageId: string | null }) => ({ id: l.id, title: l.title, messageId: l.sourceMessageId })),
  }
}
