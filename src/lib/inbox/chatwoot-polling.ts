import type { Prisma, PrismaClient } from "@prisma/client"
import { trustedChatwootBaseUrl } from "@/lib/inbox/chatwoot-trusted-host"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { isTikTokChatwootChannelConfig } from "@/lib/channels/platform-connections"
import { reconcileChatwootDeliveryFailures } from "@/lib/inbox/chatwoot-delivery-health"
import {
  ingestChatwootInbound,
  runChatwootInboundAutomation,
  type ChatwootInboundChannelConfig,
  type ChatwootInboundPayload,
  type ChatwootInboundAutomationContext,
} from "@/lib/inbox/chatwoot-inbound"

const CHATWOOT_POLL_TIMEOUT_MS = 12_000
const CHATWOOT_MAX_RESPONSE_BYTES = 1_000_000
const CHATWOOT_MAX_RETRY_AFTER_MS = 2_000
const CONVERSATIONS_PER_CONFIG = 25
const CONVERSATION_PAGES_PER_CONFIG = 4
const MESSAGES_PER_CONVERSATION = 100
const CONFIGS_PER_RUN = 20
const CONVERSATIONS_PER_RUN = 100
const MESSAGES_PER_RUN = 200
const BOOTSTRAP_AUTOMATION_WINDOW_MS = 10 * 60 * 1000

type Db = Pick<PrismaClient, "channelConfig" | "channelMessage">

type PollConfig = ChatwootInboundChannelConfig & {
  channelType: string
  configName: string
  apiKey: string | null
  isActive: boolean
}

type FetchLike = typeof fetch

type ChatwootInbox = {
  id?: unknown
  channel_type?: unknown
}

type ChatwootConversation = {
  id?: unknown
  account_id?: unknown
  inbox_id?: unknown
  status?: unknown
  can_reply?: unknown
  assignee_type?: unknown
  meta?: unknown
  messages?: unknown
}

type ChatwootMessage = Record<string, unknown>

export type ChatwootPollingResult = {
  configurations: number
  conversations: number
  messagesSeen: number
  ingested: number
  deduped: number
  ignored: number
  errors: number
  /** Our own replies this run learned the provider had refused. */
  deliveryFailuresRecorded: number
  skipped: Record<string, number>
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1
}

function settingsRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
  return asRecord(value)
}

function apiSettings(config: PollConfig): {
  baseUrl: string
  accountId: string
  inboxId: string | null
  token: string
} | null {
  const settings = settingsRecord(config.settings)
  const rawBaseUrl = stringValue(settings.baseUrl)
  const accountId = stringValue(settings.accountId)
  const inboxId = stringValue(settings.inboxId)
  const token = config.apiKey?.trim() ?? ""
  if (!rawBaseUrl || !accountId || !token) return null
  const parsed = trustedChatwootBaseUrl(rawBaseUrl)
  if (!parsed) return null
  parsed.pathname = ""
  parsed.search = ""
  parsed.hash = ""
  return { baseUrl: parsed.toString().replace(/\/$/, ""), accountId, inboxId, token }
}

async function fetchJson(
  fetcher: FetchLike,
  url: string,
  token: string,
): Promise<{ ok: true; body: unknown } | { ok: false; status: number }> {
  const requestOnce = async (): Promise<Response | null> => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), CHATWOOT_POLL_TIMEOUT_MS)
    try {
      return await fetcher(url, {
        headers: { api_access_token: token, Accept: "application/json" },
        redirect: "error",
        signal: controller.signal,
      })
    } catch {
      return null
    } finally {
      clearTimeout(timeout)
    }
  }

  const parseBoundedJson = async (response: Response): Promise<unknown | null> => {
    const declared = Number(response.headers.get("content-length"))
    if (Number.isFinite(declared) && declared > CHATWOOT_MAX_RESPONSE_BYTES) return null
    if (!response.body) return null
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let bytes = 0
    try {
      while (true) {
        const next = await reader.read()
        if (next.done) break
        bytes += next.value.byteLength
        if (bytes > CHATWOOT_MAX_RESPONSE_BYTES) {
          await reader.cancel().catch(() => {})
          return null
        }
        chunks.push(next.value)
      }
      const joined = new Uint8Array(bytes)
      let offset = 0
      for (const chunk of chunks) {
        joined.set(chunk, offset)
        offset += chunk.byteLength
      }
      return JSON.parse(new TextDecoder().decode(joined))
    } catch {
      return null
    }
  }

  let response = await requestOnce()
  if (!response) return { ok: false, status: 0 }
  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after")
    const numericSeconds = Number(retryAfter)
    const dateDelay = retryAfter && !Number.isFinite(numericSeconds)
      ? new Date(retryAfter).getTime() - Date.now()
      : numericSeconds * 1000
    const delayMs = Math.min(
      CHATWOOT_MAX_RETRY_AFTER_MS,
      Math.max(50, Number.isFinite(dateDelay) ? dateDelay : 250),
    )
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    response = await requestOnce()
    if (!response) return { ok: false, status: 0 }
  }
  if (!response.ok) return { ok: false, status: response.status }
  const body = await parseBoundedJson(response)
  if (body == null) return { ok: false, status: 0 }
  return { ok: true, body }
}

async function discoverSingleTikTokInbox(
  fetcher: FetchLike,
  api: NonNullable<ReturnType<typeof apiSettings>>,
): Promise<string | null> {
  const response = await fetchJson(
    fetcher,
    `${api.baseUrl}/api/v1/accounts/${encodeURIComponent(api.accountId)}/inboxes`,
    api.token,
  )
  if (!response.ok) return null
  const payload = asRecord(response.body).payload
  if (!Array.isArray(payload)) return null
  const tiktok = payload.filter((raw): raw is ChatwootInbox => {
    const inbox = asRecord(raw)
    return stringValue(inbox.channel_type)?.toLowerCase() === "channel::tiktok"
  })
  if (tiktok.length !== 1) return null
  return stringValue(tiktok[0].id)
}

function normalizedMessage(
  raw: ChatwootMessage,
  conversation: ChatwootConversation,
  accountId: string,
  inboxId: string,
): ChatwootInboundPayload {
  const existingConversation = asRecord(raw.conversation)
  return {
    ...raw,
    event: "message_created",
    account_id: raw.account_id ?? conversation.account_id ?? accountId,
    inbox_id: raw.inbox_id ?? conversation.inbox_id ?? inboxId,
    conversation: {
      ...existingConversation,
      id: existingConversation.id ?? raw.conversation_id ?? conversation.id,
      account_id: existingConversation.account_id ?? conversation.account_id ?? accountId,
      inbox_id: existingConversation.inbox_id ?? conversation.inbox_id ?? inboxId,
    },
  }
}

function numericMessageId(value: unknown): number | null {
  const numeric = Number(value)
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null
}

function sourceCreatedAt(value: unknown): Date | null {
  const numeric = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  const date = new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
  return Number.isNaN(date.getTime()) ? null : date
}

function messageType(value: unknown): "incoming" | "outgoing" | "other" {
  if (value === "incoming" || value === 0) return "incoming"
  if (value === "outgoing" || value === 1) return "outgoing"
  return "other"
}

function isPollableTextInbound(message: ChatwootMessage): boolean {
  if (messageType(message.message_type) !== "incoming" || message.private === true) return false
  if (!stringValue(message.content)) return false
  return !Array.isArray(message.attachments) || message.attachments.length === 0
}

function outboundCoverageState(
  message: ChatwootMessage,
): "covered" | "uncertain" | null {
  if (messageType(message.message_type) !== "outgoing" || message.private === true) return null
  const status = stringValue(message.status)?.toLowerCase()
  if (["sent", "delivered", "read"].includes(status ?? "")) return "covered"
  if (status === "failed") return null
  return "uncertain"
}

function sourceConversationBlocksAutomation(conversation: ChatwootConversation): boolean {
  if (stringValue(conversation.status)?.toLowerCase() !== "open") return true
  if (conversation.can_reply !== true) return true
  const meta = asRecord(conversation.meta)
  const assignee = asRecord(meta.assignee)
  const assigneeType = (
    stringValue(meta.assignee_type)
    ?? stringValue(assignee.type)
    ?? stringValue(conversation.assignee_type)
    ?? ""
  ).toLowerCase().replace(/[^a-z]/g, "")
  return assigneeType === "agentbot"
}

async function knownProviderCursor(
  db: Db,
  organizationId: string,
  conversationId: string,
): Promise<number | null> {
  const rows = await db.channelMessage.findMany({
    where: {
      organizationId,
      channelType: "tiktok",
      direction: "inbound",
      metadata: { path: ["chatwootConversationId"], equals: conversationId },
      externalId: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { externalId: true },
  })
  let cursor: number | null = null
  for (const row of rows) {
    const id = numericMessageId(row.externalId)
    if (id != null && (cursor == null || id > cursor)) cursor = id
  }
  return cursor
}

async function fetchConversationMessages(input: {
  fetcher: FetchLike
  api: NonNullable<ReturnType<typeof apiSettings>>
  conversation: ChatwootConversation
  inboxId: string
}): Promise<ChatwootMessage[] | null> {
  const conversationId = stringValue(input.conversation.id)
  if (!conversationId) return null
  const url = new URL(
    `${input.api.baseUrl}/api/v1/accounts/${encodeURIComponent(input.api.accountId)}/conversations/${encodeURIComponent(conversationId)}/messages`,
  )
  url.searchParams.set("filter_internal_messages", "true")
  const response = await fetchJson(input.fetcher, url.toString(), input.api.token)
  if (!response.ok) return null
  const payload = asRecord(response.body).payload
  if (!Array.isArray(payload)) return null
  return payload.slice(0, MESSAGES_PER_CONVERSATION).map(asRecord)
}

/**
 * Minute backstop for Chatwoot message_created delivery gaps. Every external
 * read is pinned to one active tenant config, one Chatwoot account and one
 * exact TikTok inbox. The work per run is hard-bounded and idempotency stays
 * in the shared canonical ingest path.
 */
export async function pollChatwootTikTokInbounds(
  db: Db = prisma,
  options: { fetcher?: FetchLike } = {},
): Promise<ChatwootPollingResult> {
  const fetcher = options.fetcher ?? fetch
  const result: ChatwootPollingResult = {
    configurations: 0,
    conversations: 0,
    messagesSeen: 0,
    ingested: 0,
    deduped: 0,
    ignored: 0,
    errors: 0,
    deliveryFailuresRecorded: 0,
    skipped: {},
  }
  const configCount = await db.channelConfig.count({
    where: { channelType: "chatwoot", isActive: true },
  })
  const rotatingSkip = configCount > CONFIGS_PER_RUN
    ? (Math.floor(Date.now() / 60_000) * CONFIGS_PER_RUN) % configCount
    : 0
  let configs = await db.channelConfig.findMany({
    where: { channelType: "chatwoot", isActive: true },
    orderBy: { id: "asc" },
    skip: rotatingSkip,
    take: CONFIGS_PER_RUN,
    select: {
      id: true,
      organizationId: true,
      channelType: true,
      configName: true,
      apiKey: true,
      settings: true,
      isActive: true,
    },
  }) as PollConfig[]
  // Wrap at the end instead of starving rows after the rotating window reaches
  // the table boundary. Stable id ordering makes every config eligible over
  // successive minute ticks without an unbounded scan.
  if (configs.length < Math.min(CONFIGS_PER_RUN, configCount)) {
    const wrapped = await db.channelConfig.findMany({
      where: { channelType: "chatwoot", isActive: true },
      orderBy: { id: "asc" },
      take: Math.min(CONFIGS_PER_RUN, configCount) - configs.length,
      select: {
        id: true,
        organizationId: true,
        channelType: true,
        configName: true,
        apiKey: true,
        settings: true,
        isActive: true,
      },
    }) as PollConfig[]
    const seen = new Set(configs.map((config) => config.id))
    configs = [...configs, ...wrapped.filter((config) => !seen.has(config.id))]
  }

  let conversationsFetched = 0
  for (const [configIndex, config] of configs.entries()) {
    if (conversationsFetched >= CONVERSATIONS_PER_RUN) break
    if (!isTikTokChatwootChannelConfig(config)) {
      increment(result.skipped, "not-tiktok")
      continue
    }
    const api = apiSettings(config)
    if (!api) {
      increment(result.skipped, "incomplete-config")
      continue
    }
    result.configurations++
    const inboxId = api.inboxId ?? await discoverSingleTikTokInbox(fetcher, api)
    if (!inboxId) {
      increment(result.skipped, "inbox-unresolved")
      continue
    }

    const conversationPayload: unknown[] = []
    const remainingConfigs = Math.max(1, configs.length - configIndex)
    const configConversationBudget = Math.max(
      1,
      Math.floor((CONVERSATIONS_PER_RUN - conversationsFetched) / remainingConfigs),
    )
    for (let page = 1; page <= CONVERSATION_PAGES_PER_CONFIG; page++) {
      const conversationsUrl = new URL(
        `${api.baseUrl}/api/v1/accounts/${encodeURIComponent(api.accountId)}/conversations`,
      )
      conversationsUrl.searchParams.set("inbox_id", inboxId)
      conversationsUrl.searchParams.set("status", "all")
      conversationsUrl.searchParams.set("assignee_type", "all")
      conversationsUrl.searchParams.set("sort_by", "last_activity_at_desc")
      conversationsUrl.searchParams.set("page", String(page))
      const conversationsResponse = await fetchJson(fetcher, conversationsUrl.toString(), api.token)
      if (!conversationsResponse.ok) {
        result.errors++
        increment(result.skipped, `conversations-http-${conversationsResponse.status}`)
        break
      }
      const pagePayload = asRecord(asRecord(conversationsResponse.body).data).payload
      if (!Array.isArray(pagePayload)) {
        result.errors++
        increment(result.skipped, "invalid-conversations")
        break
      }
      const remaining = configConversationBudget - conversationPayload.length
      if (remaining <= 0) break
      const accepted = pagePayload.slice(0, Math.min(CONVERSATIONS_PER_CONFIG, remaining))
      conversationPayload.push(...accepted)
      conversationsFetched += accepted.length
      if (pagePayload.length < CONVERSATIONS_PER_CONFIG) break
    }

    for (const rawConversation of conversationPayload) {
      if (result.messagesSeen >= MESSAGES_PER_RUN) break
      const conversation = asRecord(rawConversation) as ChatwootConversation
      const conversationId = stringValue(conversation.id)
      const returnedInboxId = stringValue(conversation.inbox_id)
      const returnedAccountId = stringValue(conversation.account_id)
      if (!conversationId || returnedInboxId !== inboxId || returnedAccountId !== api.accountId) {
        result.ignored++
        continue
      }
      result.conversations++
      const cursor = await runWithTenant(config.organizationId, () =>
        knownProviderCursor(db, config.organizationId, conversationId),
      )
      // Always reconcile the bounded recent page instead of using `after=max`:
      // provider delivery can arrive out of order, so a newer webhook id must
      // never make us skip an older-id hole on the same recent page.
      const messages = await fetchConversationMessages({ fetcher, api, conversation, inboxId })
      if (!messages) {
        result.errors++
        continue
      }

      // This page already carries the provider's verdict on our own replies —
      // outboundCoverageState reads the very same `status` field below. Write it
      // back before anything else looks at the conversation, so a reply the
      // provider refused stops claiming it was delivered and the automation
      // gate downstream sees the real streak. Never fatal: a reconciliation
      // failure must not cost us the inbound messages on this page.
      const reconciled = await runWithTenant(config.organizationId, () =>
        reconcileChatwootDeliveryFailures(db, {
          organizationId: config.organizationId,
          messages,
        }),
      ).catch(() => null)
      if (reconciled == null) increment(result.skipped, "delivery-reconcile-failed")
      else if (reconciled > 0) result.deliveryFailuresRecorded += reconciled

      const contexts: ChatwootInboundAutomationContext[] = []
      const sourceStateBlocksAutomation = sourceConversationBlocksAutomation(conversation)
      const ordered = messages
        .filter((message) => numericMessageId(message.id) != null)
        .sort((a, b) => (numericMessageId(a.id) ?? 0) - (numericMessageId(b.id) ?? 0))
      const incoming = ordered.filter((message) => messageType(message.message_type) === "incoming")
      const outbounds = ordered
        .map((message) => ({ message, state: outboundCoverageState(message) }))
        .filter((entry): entry is { message: ChatwootMessage; state: "covered" | "uncertain" } => entry.state != null)
      for (const message of incoming) {
        if (result.messagesSeen >= MESSAGES_PER_RUN) break
        result.messagesSeen++
        // The first rollout intentionally recovers plain-text DMs only. Media
        // URLs require their own redirect-safe fetch policy and must continue
        // through the live webhook path until that boundary is hardened.
        if (!isPollableTextInbound(message)) {
          increment(result.skipped, "non-text-inbound")
          continue
        }
        const messageId = numericMessageId(message.id) ?? 0
        const laterOutbounds = outbounds.filter(
          (entry) => (numericMessageId(entry.message.id) ?? 0) > messageId,
        )
        const laterSourceReply = laterOutbounds.find((entry) => entry.state === "covered")
          ?? laterOutbounds.find((entry) => entry.state === "uncertain")
        const providerDate = sourceCreatedAt(message.created_at)
        const tooOldForAutomation = cursor == null && (
          !providerDate
          || Date.now() - providerDate.getTime() > BOOTSTRAP_AUTOMATION_WINDOW_MS
        )
        if (tooOldForAutomation) increment(result.skipped, "bootstrap-history")
        const sourceReplyCoverage = laterSourceReply ? {
          state: laterSourceReply.state,
          sourceMessageId: String(laterSourceReply.message.id),
        } : sourceStateBlocksAutomation ? {
          state: "uncertain" as const,
          sourceMessageId: `conversation-state:${conversationId}`,
        } : null
        const outcome = await ingestChatwootInbound({
          payload: normalizedMessage(message, conversation, api.accountId, inboxId),
          channelConfig: config,
          expectedInboxId: inboxId,
          deferAutomation: true,
          origin: "poller",
          sourceReplyCoverage,
          suppressAutomationReason: tooOldForAutomation ? "source-too-old" : null,
        })
        if (outcome.ingested) result.ingested++
        else if (outcome.deduped) result.deduped++
        else if (outcome.ignored) result.ignored++
        if (outcome.automation) contexts.push(outcome.automation)
      }
      if (contexts.length) {
        await runWithTenant(config.organizationId, () => runChatwootInboundAutomation(contexts))
      }
    }
  }
  return result
}
