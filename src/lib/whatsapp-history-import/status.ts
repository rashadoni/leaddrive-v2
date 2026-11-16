/**
 * Where a coexistence number's import stands, in the words the settings screen shows.
 *
 * Read from the captured chunks rather than kept as a running counter: chunks arrive in any order,
 * may be processed twice, and a counter updated from several places would drift. The chunks are the
 * record; this only adds them up.
 */
import { prisma } from "@/lib/prisma"
import { isCoexistenceChannel } from "@/lib/whatsapp-number-onboarding"
import { HISTORY_SHARING_DECLINED } from "./payload"
import { insideSyncWindow, readHistoryImportSetting, SYNC_WINDOW_MS, type SyncRequestRecord } from "./request"

export type HistoryImportState =
  /** Not a number that lives in the WhatsApp Business app — nothing to import. */
  | "not_coexistence"
  /** Connected before the import existed, or the request never ran. */
  | "not_requested"
  /** Meta refused both requests. */
  | "request_failed"
  /** Requested; Meta has sent nothing yet («can take several minutes»). */
  | "waiting"
  | "importing"
  | "done"
  /** The business did not share its chat history (Meta 2593109); contacts may still have come. */
  | "declined"
  /** Everything that arrived was tried, and some of it could not be written. */
  | "partly_failed"

export type HistoryImportView = {
  state: HistoryImportState
  onboardedAt: string | null
  /** Until when a refused request may be asked again. */
  windowEndsAt: string | null
  canRetry: boolean
  requests: { contacts: SyncRequestRecord | null; history: SyncRequestRecord | null }
  contacts: { received: number; created: number; matched: number; overPlanLimit: number; pending: number }
  /** The real files Meta sends after the history, for the last two weeks only. */
  media: { received: number; stored: number; pending: number }
  history: {
    /** Meta's own figure, 0–100; 100 means it has sent everything. */
    progress: number | null
    conversations: number
    messages: number
    pendingChunks: number
    failedChunks: number
    declined: boolean
  }
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0)

export async function historyImportStatus(organizationId: string, channelConfigId: string, now: Date = new Date()): Promise<HistoryImportView | null> {
  const channel = await prisma.channelConfig.findFirst({
    where: { id: channelConfigId, organizationId, channelType: "whatsapp" },
    select: { settings: true },
  })
  if (!channel) return null
  const settings = rec(channel.settings)
  const requests = readHistoryImportSetting(settings)
  const onboardedAt = typeof settings.onboardedAt === "string" ? settings.onboardedAt : null
  const onboardedMs = onboardedAt ? Date.parse(onboardedAt) : NaN
  const chunks: Array<{ kind: string; status: string; progress: number | null; errorCode: number | null; items: number; result: unknown }> = await prisma.whatsAppHistoryChunk.findMany({
    where: { organizationId, channelConfigId },
    select: { kind: true, status: true, progress: true, errorCode: true, items: true, result: true },
  })

  const view: HistoryImportView = {
    state: "not_requested",
    onboardedAt,
    windowEndsAt: Number.isFinite(onboardedMs) ? new Date(onboardedMs + SYNC_WINDOW_MS).toISOString() : null,
    canRetry: false,
    requests: { contacts: requests.contacts ?? null, history: requests.history ?? null },
    contacts: { received: 0, created: 0, matched: 0, overPlanLimit: 0, pending: 0 },
    media: { received: 0, stored: 0, pending: 0 },
    history: { progress: null, conversations: 0, messages: 0, pendingChunks: 0, failedChunks: 0, declined: false },
  }
  for (const chunk of chunks) {
    const result = rec(chunk.result)
    const open = chunk.status === "pending" || chunk.status === "processing"
    if (chunk.kind === "contacts") {
      view.contacts.received += chunk.items
      view.contacts.created += num(result.created)
      view.contacts.matched += num(result.matched)
      view.contacts.overPlanLimit += num(result.overPlanLimit)
      if (open) view.contacts.pending += chunk.items
      continue
    }
    if (chunk.kind === "media") {
      view.media.received += chunk.items
      view.media.stored += num(result.stored)
      if (open) view.media.pending += chunk.items
      continue
    }
    if (chunk.kind !== "history") continue
    if (chunk.errorCode !== null) {
      if (chunk.errorCode === HISTORY_SHARING_DECLINED) view.history.declined = true
      continue
    }
    if (chunk.progress !== null) view.history.progress = Math.max(view.history.progress ?? 0, chunk.progress)
    if (open) view.history.pendingChunks += 1
    if (chunk.status === "failed") view.history.failedChunks += 1
  }

  // One count everywhere it is shown (the channel row, the inbox card, the import screen): the
  // conversations and messages the import has put in the inbox, read from the rows themselves.
  if (chunks.some((chunk) => chunk.kind === "history")) {
    const imported = { organizationId, channelConfigId, historyImportedAt: { not: null } } as const
    const [conversations, messages] = await Promise.all([
      prisma.channelMessage.groupBy({ by: ["conversationId"], where: { ...imported, NOT: { conversationId: null } } }),
      prisma.channelMessage.count({ where: imported }),
    ])
    view.history.conversations = conversations.length
    view.history.messages = messages
  }

  const coexistence = isCoexistenceChannel(settings)
  const refused = (r: SyncRequestRecord | undefined) => !!r && !r.requestId
  view.canRetry = coexistence && insideSyncWindow(settings, now) && (refused(requests.contacts) || refused(requests.history))
  const anyChunk = chunks.length > 0
  const pending = view.contacts.pending > 0 || view.history.pendingChunks > 0 || view.media.pending > 0
  if (!coexistence && !anyChunk) view.state = "not_coexistence"
  else if (view.history.declined && !pending) view.state = "declined"
  else if (pending) view.state = "importing"
  else if (view.history.failedChunks > 0) view.state = "partly_failed"
  else if (view.history.progress === 100) view.state = "done"
  else if (anyChunk) view.state = "importing"
  else if (requests.contacts?.requestId || requests.history?.requestId) view.state = "waiting"
  else if (refused(requests.contacts) && refused(requests.history)) view.state = "request_failed"
  else view.state = "not_requested"
  return view
}

// ─── the import screen in the inbox ──────────────────────────────────────────

export type HistoryImportDetail = HistoryImportView & {
  channelId: string
  configName: string
  displayPhoneNumber: string | null
  /** The number's state right now: still in the app and on the Cloud API, or paused by Meta. */
  phone: "connected" | "paused" | "disconnected"
  /** What is in the inbox now, counted from the rows themselves. */
  counts: { conversations: number; messages: number; media: number; mediaFiles: number }
  /** Imported messages per month of their own date, oldest first. */
  months: Array<{ month: string; messages: number }>
  newContacts: { total: number; shown: Array<{ id: string; name: string }> }
  /** The conversations the import wrote into most recently. */
  feed: Array<{ conversationId: string; name: string; lastMessage: string; at: string }>
}

export async function historyImportDetail(organizationId: string, channelConfigId: string): Promise<HistoryImportDetail | null> {
  const view = await historyImportStatus(organizationId, channelConfigId)
  if (!view) return null
  const channel = await prisma.channelConfig.findFirst({
    where: { id: channelConfigId, organizationId },
    select: { configName: true, isActive: true, settings: true },
  })
  const settings = rec(channel?.settings)
  const imported = { organizationId, channelConfigId, historyImportedAt: { not: null } } as const

  const [media, mediaFiles, monthRows, chunkResults, recent] = await Promise.all([
    prisma.channelMessage.count({ where: { ...imported, NOT: { messageType: "text" } } }),
    prisma.channelMessage.count({ where: { ...imported, NOT: { mediaUrl: null } } }),
    prisma.$queryRaw<Array<{ month: string; messages: number }>>`
      SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS month, count(*)::int AS messages
      FROM "channel_messages"
      WHERE "organizationId" = ${organizationId} AND "channelConfigId" = ${channelConfigId}
        AND "historyImportedAt" IS NOT NULL
      GROUP BY 1 ORDER BY 1`,
    prisma.whatsAppHistoryChunk.findMany({
      where: { organizationId, channelConfigId, kind: "contacts", status: "done" },
      select: { result: true },
      orderBy: { receivedAt: "asc" },
    }),
    prisma.channelMessage.findMany({
      where: { ...imported, NOT: { conversationId: null } },
      distinct: ["conversationId"],
      orderBy: [{ historyImportedAt: "desc" }, { createdAt: "desc" }],
      take: 6,
      select: { conversationId: true },
    }),
  ])

  const createdIds = (chunkResults as Array<{ result: unknown }>).flatMap((row) => {
    const ids = rec(row.result).createdContactIds
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []
  })
  const shownContacts: Array<{ id: string; fullName: string }> = createdIds.length > 0
    ? await prisma.contact.findMany({ where: { organizationId, id: { in: createdIds.slice(0, 15) } }, select: { id: true, fullName: true } })
    : []
  const order = new Map(createdIds.map((id, i) => [id, i]))
  shownContacts.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))

  const recentIds = (recent as Array<{ conversationId: string | null }>).map((row) => row.conversationId).filter((id): id is string => !!id)
  const conversations: Array<{ id: string; contactName: string; externalId: string; lastMessage: string | null; lastMessageAt: Date }> = recentIds.length > 0
    ? await prisma.socialConversation.findMany({
      where: { organizationId, id: { in: recentIds } },
      select: { id: true, contactName: true, externalId: true, lastMessage: true, lastMessageAt: true },
    })
    : []
  const byId = new Map(conversations.map((c) => [c.id, c]))

  return {
    ...view,
    channelId: channelConfigId,
    configName: channel?.configName ?? "WhatsApp",
    displayPhoneNumber: typeof settings.displayPhoneNumber === "string" ? settings.displayPhoneNumber : null,
    // `isActive` alone says cut off: PARTNER_REMOVED switches the row off together with writing
    // `disconnected`, and only a new Embedded Signup switches it on — so on an active row that mark
    // is left over from the connection before.
    phone: !channel?.isActive ? "disconnected" : settings.cloudApiPaused ? "paused" : "connected",
    counts: { conversations: view.history.conversations, messages: view.history.messages, media, mediaFiles },
    months: (monthRows as Array<{ month: string; messages: number }>).map((row) => ({ month: row.month, messages: Number(row.messages) })),
    newContacts: { total: view.contacts.created, shown: shownContacts.map((c) => ({ id: c.id, name: c.fullName })) },
    feed: recentIds.flatMap((id) => {
      const c = byId.get(id)
      return c ? [{ conversationId: c.id, name: c.contactName || c.externalId, lastMessage: c.lastMessage ?? "", at: c.lastMessageAt.toISOString() }] : []
    }),
  }
}

/** States worth a banner in the inbox: something is coming, or it came in the last three days. */
const BANNER_FRESH_MS = 3 * 24 * 3600_000
export function importWorthShowing(view: HistoryImportView, now: Date = new Date()): boolean {
  if (view.state === "waiting" || view.state === "importing") return true
  if (view.state === "not_coexistence" || view.state === "not_requested") return false
  const since = view.onboardedAt ? Date.parse(view.onboardedAt) : NaN
  return Number.isFinite(since) && now.getTime() - since < BANNER_FRESH_MS
}

export type HistoryImportSummary = {
  channelId: string
  displayPhoneNumber: string | null
  state: HistoryImportState
  progress: number | null
  conversations: number
  contacts: number
}

/** The imports to show in the inbox, on the channels this person may see. */
export async function inboxHistoryImports(organizationId: string, visible: (channelId: string) => boolean, now: Date = new Date()): Promise<HistoryImportSummary[]> {
  const channels = await prisma.channelConfig.findMany({
    where: { organizationId, channelType: "whatsapp", isActive: true },
    select: { id: true, settings: true },
    orderBy: { createdAt: "asc" },
  })
  const out: HistoryImportSummary[] = []
  for (const channel of channels) {
    if (!isCoexistenceChannel(channel.settings) || !visible(channel.id)) continue
    const view = await historyImportStatus(organizationId, channel.id, now)
    if (!view || !importWorthShowing(view, now)) continue
    const settings = rec(channel.settings)
    out.push({
      channelId: channel.id,
      displayPhoneNumber: typeof settings.displayPhoneNumber === "string" ? settings.displayPhoneNumber : null,
      state: view.state,
      progress: view.state === "done" ? 100 : view.history.progress,
      conversations: view.history.conversations,
      contacts: view.contacts.created + view.contacts.matched,
    })
  }
  return out
}
