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
  const chunks = await prisma.whatsAppHistoryChunk.findMany({
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
    if (chunk.kind !== "history") continue
    if (chunk.errorCode !== null) {
      if (chunk.errorCode === HISTORY_SHARING_DECLINED) view.history.declined = true
      continue
    }
    if (chunk.progress !== null) view.history.progress = Math.max(view.history.progress ?? 0, chunk.progress)
    view.history.conversations += num(result.conversationsCreated)
    view.history.messages += num(result.imported)
    if (open) view.history.pendingChunks += 1
    if (chunk.status === "failed") view.history.failedChunks += 1
  }

  const coexistence = isCoexistenceChannel(settings)
  const refused = (r: SyncRequestRecord | undefined) => !!r && !r.requestId
  view.canRetry = coexistence && insideSyncWindow(settings, now) && (refused(requests.contacts) || refused(requests.history))
  const anyChunk = chunks.length > 0
  const pending = view.contacts.pending > 0 || view.history.pendingChunks > 0
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
