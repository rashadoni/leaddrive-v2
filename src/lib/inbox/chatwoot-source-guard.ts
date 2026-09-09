import type { PrismaClient } from "@prisma/client"
import { trustedChatwootBaseUrl } from "@/lib/inbox/chatwoot-trusted-host"
import { prisma } from "@/lib/prisma"

const MAX_RESPONSE_BYTES = 1_000_000
const FETCH_TIMEOUT_MS = 12_000

type Db = Pick<PrismaClient, "channelConfig">

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

async function readBoundedJson(fetcher: typeof fetch, url: URL, token: string): Promise<unknown | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetcher(url, {
      headers: { api_access_token: token, Accept: "application/json" },
      redirect: "error",
      signal: controller.signal,
    })
    if (!response.ok) return null
    const declared = Number(response.headers.get("content-length"))
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) return null
    if (!response.body) return null
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let bytes = 0
    while (true) {
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.byteLength
      if (bytes > MAX_RESPONSE_BYTES) {
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
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Last-moment Chatwoot ownership check shared by delayed polling and backlog
 * recovery. Any incomplete, untrusted or mismatched source response fails
 * closed; only an exact open conversation with no later outgoing may send.
 */
export async function chatwootSourceStillUnanswered(input: {
  organizationId: string
  channelConfigId: string
  channelSettings: unknown
  chatwootConversationId: string
  chatwootInboxId: unknown
  inboundProviderMessageIds: unknown[]
  db?: Db
  fetcher?: typeof fetch
}): Promise<boolean> {
  const settings = asRecord(input.channelSettings)
  const rawBaseUrl = stringValue(settings.baseUrl)
  const accountId = stringValue(settings.accountId)
  const inboxId = stringValue(input.chatwootInboxId) ?? stringValue(settings.inboxId)
  const db = input.db ?? prisma
  const token = await db.channelConfig.findFirst({
    where: {
      id: input.channelConfigId,
      organizationId: input.organizationId,
      channelType: "chatwoot",
      isActive: true,
    },
    select: { apiKey: true },
  }).then((row) => row?.apiKey?.trim() ?? "").catch(() => "")
  if (!rawBaseUrl || !accountId || !inboxId || !token) return false

  const baseUrl = trustedChatwootBaseUrl(rawBaseUrl)
  if (!baseUrl) return false

  const conversationUrl = new URL(baseUrl)
  conversationUrl.pathname = `/api/v1/accounts/${encodeURIComponent(accountId)}/conversations/${encodeURIComponent(input.chatwootConversationId)}`
  conversationUrl.search = ""
  conversationUrl.hash = ""
  const messagesUrl = new URL(conversationUrl)
  messagesUrl.pathname += "/messages"
  messagesUrl.searchParams.set("filter_internal_messages", "true")

  const fetcher = input.fetcher ?? fetch
  const conversationBody = asRecord(await readBoundedJson(fetcher, conversationUrl, token))
  const nestedConversation = asRecord(conversationBody.payload)
  const sourceConversation = Object.keys(nestedConversation).length ? nestedConversation : conversationBody
  const sourceMeta = asRecord(sourceConversation.meta)
  const sourceAssignee = asRecord(sourceMeta.assignee)
  const assigneeType = (
    stringValue(sourceMeta.assignee_type)
    ?? stringValue(sourceAssignee.type)
    ?? stringValue(sourceConversation.assignee_type)
    ?? ""
  ).toLowerCase().replace(/[^a-z]/g, "")
  const returnedAccountId = stringValue(sourceConversation.account_id)
    ?? stringValue(asRecord(sourceConversation.account).id)
  if (
    stringValue(sourceConversation.id) !== input.chatwootConversationId
    || returnedAccountId !== accountId
    || stringValue(sourceConversation.inbox_id) !== inboxId
    || stringValue(sourceConversation.status)?.toLowerCase() !== "open"
    || sourceConversation.can_reply !== true
    || assigneeType === "agentbot"
  ) return false

  const newestInboundId = Math.max(
    ...input.inboundProviderMessageIds.map((value) => Number(value)),
    0,
  )
  if (!Number.isSafeInteger(newestInboundId) || newestInboundId <= 0) return false

  const messageBody = asRecord(await readBoundedJson(fetcher, messagesUrl, token))
  if (!Array.isArray(messageBody.payload)) return false
  return !messageBody.payload.some((raw) => {
    const message = asRecord(raw)
    const id = Number(message.id)
    if (!Number.isSafeInteger(id) || id <= newestInboundId) return false
    if (!(message.message_type === "outgoing" || message.message_type === 1) || message.private === true) {
      return false
    }
    return stringValue(message.status)?.toLowerCase() !== "failed"
  })
}
