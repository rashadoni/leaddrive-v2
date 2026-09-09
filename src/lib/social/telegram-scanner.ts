import { prisma } from "@/lib/prisma"
import { decryptToken } from "@/lib/secure-token"
import { ingestMention, ingestMentionWithResult, findMatchedKeyword } from "@/lib/social/ingest-mention"
import { observationContextForCollector, routeExecutionMetadata } from "@/lib/social/collector-observation-context"
import { withSocialProviderTimeout } from "@/lib/social/provider-request-timeout"
import type { MonitoringCollectorResult, MonitoringSourceForRun } from "@/lib/social/monitoring-collector"

const TELEGRAM_ADAPTER = "TELEGRAM_BOT_API"
const CURSOR_KEY = "getUpdates"

type TelegramMessage = {
  message_id: number
  date: number
  text?: string
  caption?: string
  chat: { id: number; type?: string; title?: string; username?: string }
  sender_chat?: { id?: number; title?: string; username?: string }
  reply_to_message?: TelegramMessage
  forward_origin?: { type?: string; chat?: { id?: number; username?: string }; message_id?: number }
  is_automatic_forward?: boolean
}

type TelegramUpdate = {
  update_id: number
  channel_post?: TelegramMessage
  edited_channel_post?: TelegramMessage
  message?: TelegramMessage
  edited_message?: TelegramMessage
}

type TelegramAccount = {
  id: string
  organizationId: string
  handle: string
  accessToken: string | null
  keywords: string[]
  isActive: boolean
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function botToken(account: TelegramAccount): string | null {
  if (account.accessToken) {
    for (const purpose of [`oauth:telegram:${account.handle}`, "oauth:telegram"]) {
      try {
        const token = decryptToken(account.accessToken, purpose).split("::")[0]?.trim()
        if (token) return token
      } catch { /* try the next supported key purpose */ }
    }
  }
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || null
}

async function loadCursor(account: TelegramAccount): Promise<number> {
  const cursor = await prisma.socialConnectionCursor.findUnique({
    where: {
      organizationId_accountId_adapterKey_cursorKey: {
        organizationId: account.organizationId,
        accountId: account.id,
        adapterKey: TELEGRAM_ADAPTER,
        cursorKey: CURSOR_KEY,
      },
    },
    select: { cursorValue: true },
  })
  const parsed = Number(cursor?.cursorValue ?? 0)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}

async function saveCursor(account: TelegramAccount, cursorValue: number, lastEventAt: Date | null): Promise<void> {
  await prisma.socialConnectionCursor.upsert({
    where: {
      organizationId_accountId_adapterKey_cursorKey: {
        organizationId: account.organizationId,
        accountId: account.id,
        adapterKey: TELEGRAM_ADAPTER,
        cursorKey: CURSOR_KEY,
      },
    },
    create: {
      organizationId: account.organizationId,
      accountId: account.id,
      adapterKey: TELEGRAM_ADAPTER,
      cursorKey: CURSOR_KEY,
      cursorValue: String(cursorValue),
      lastEventAt,
    },
    update: {
      cursorValue: String(cursorValue),
      cursorVersion: { increment: 1 },
      lastEventAt,
    },
  })
}

function normalizedHandle(value: string | null | undefined): string | null {
  const handle = value?.trim().replace(/^@+/, "").toLowerCase()
  return handle || null
}

function discussionAllowed(source: MonitoringSourceForRun | null, message: TelegramMessage): boolean {
  if (!source) return false
  const settings = record(source.settings)
  const configuredIds = [settings.discussionChatId, ...(Array.isArray(settings.discussionChatIds) ? settings.discussionChatIds : [])]
    .map(value => String(value ?? "").trim()).filter(Boolean)
  const configuredHandles = [settings.discussionHandle, ...(Array.isArray(settings.discussionHandles) ? settings.discussionHandles : [])]
    .map(value => normalizedHandle(typeof value === "string" ? value : null)).filter((value): value is string => Boolean(value))
  if (configuredIds.includes(String(message.chat.id))) return true
  if (normalizedHandle(message.chat.username) && configuredHandles.includes(normalizedHandle(message.chat.username) as string)) return true
  const forwardedChat = message.forward_origin?.chat
  const sourceHandle = normalizedHandle(source.handle)
  return Boolean(sourceHandle && normalizedHandle(forwardedChat?.username) === sourceHandle)
}

function classifyUpdate(update: TelegramUpdate, account: TelegramAccount, source: MonitoringSourceForRun | null) {
  const message = update.channel_post ?? update.edited_channel_post ?? update.message ?? update.edited_message
  if (!message) return null
  const text = (message.text || message.caption || "").trim()
  if (!text) return null
  const accountHandle = normalizedHandle(account.handle)
  const chatHandle = normalizedHandle(message.chat.username)
  const ownedChannelPost = Boolean((update.channel_post || update.edited_channel_post) && accountHandle && chatHandle === accountHandle)
  const discussion = !ownedChannelPost && discussionAllowed(source, message)
  if (!ownedChannelPost && !discussion) return null
  const edited = Boolean(update.edited_channel_post || update.edited_message)
  const parentMessage = message.reply_to_message
  return { message, text, ownedChannelPost, discussion, edited, parentMessage }
}

async function scanTelegramAccount(account: TelegramAccount, source: MonitoringSourceForRun | null): Promise<MonitoringCollectorResult> {
  const token = botToken(account)
  if (!token) return { status: "skipped", foundCount: 0, newCount: 0, duplicateCount: 0, ignoredCount: 0, error: "telegram_bot_token_missing" }
  const offset = await loadCursor(account)
  const url = new URL(`https://api.telegram.org/bot${token}/getUpdates`)
  url.searchParams.set("offset", String(offset))
  url.searchParams.set("limit", "100")
  url.searchParams.set("timeout", "0")
  url.searchParams.set("allowed_updates", JSON.stringify(["channel_post", "edited_channel_post", "message", "edited_message"]))
  const telegramResponse = await withSocialProviderTimeout("telegram", async signal => {
    const response = await fetch(url, { signal })
    return {
      response,
      body: response.ok
        ? await response.json() as { ok: boolean; result?: TelegramUpdate[]; description?: string }
        : null,
    }
  }, { signal: source?.providerRequestSignal })
  const { response } = telegramResponse
  if (!response.ok) return { status: "failed", foundCount: 0, newCount: 0, duplicateCount: 0, ignoredCount: 0, error: `telegram_get_updates_${response.status}` }
  const body = telegramResponse.body as { ok: boolean; result?: TelegramUpdate[]; description?: string }
  if (!body.ok) return { status: "failed", foundCount: 0, newCount: 0, duplicateCount: 0, ignoredCount: 0, error: body.description || "telegram_api_error" }

  const keywords = Array.from(new Set([...(account.keywords ?? []), ...(source?.keywords ?? [])].map(value => value.trim()).filter(Boolean)))
  let maxUpdateId = offset
  let lastEventAt: Date | null = null
  let foundCount = 0
  let newCount = 0
  let duplicateCount = 0
  let ignoredCount = 0
  for (const update of body.result ?? []) {
    maxUpdateId = Math.max(maxUpdateId, update.update_id + 1)
    const item = classifyUpdate(update, account, source)
    if (!item) { ignoredCount += 1; continue }
    const matchedTerm = findMatchedKeyword(item.text, keywords)
    // Legacy account polling has no MonitoringSource route to apply the
    // observation relevance policy. Preserve the previous keyword boundary
    // here so off-topic delivered channel posts never become durable mentions.
    if (!source && keywords.length > 0 && !matchedTerm) { ignoredCount += 1; continue }
    foundCount += 1
    const parentId = item.parentMessage?.message_id ?? null
    const platformExternalId = `${item.message.chat.id}_${item.message.message_id}`
    const publicHandle = normalizedHandle(item.message.chat.username)
    const permalink = publicHandle ? `https://t.me/${publicHandle}/${item.message.message_id}` : null
    const input = {
      organizationId: account.organizationId,
      accountId: account.id,
      platform: "telegram",
      externalId: platformExternalId,
      sourceType: item.discussion ? (parentId ? "reply" : "comment") : "post",
      contentKind: item.discussion ? (parentId ? "REPLY" : "COMMENT") : "POST",
      postExternalId: item.discussion && item.parentMessage ? `${item.message.chat.id}_${item.parentMessage.message_id}` : platformExternalId,
      parentExternalId: parentId ? `${item.message.chat.id}_${parentId}` : null,
      threadExternalId: item.discussion ? `${item.message.chat.id}_${parentId ?? item.message.message_id}` : platformExternalId,
      replyToExternalId: parentId ? `${item.message.chat.id}_${parentId}` : null,
      depth: parentId ? 1 : 0,
      canonicalUrl: permalink,
      parentPostUrl: item.discussion && item.parentMessage && publicHandle ? `https://t.me/${publicHandle}/${item.parentMessage.message_id}` : null,
      editedAt: item.edited ? new Date(item.message.date * 1000) : null,
      sourceProvider: "native",
      sourceMetadata: {
        telegramChatId: String(item.message.chat.id),
        telegramUpdateId: update.update_id,
        discussion: item.discussion,
        ...(source ? routeExecutionMetadata(source) : {}),
      },
      text: item.text,
      sentiment: null,
      matchedTerm,
      url: permalink,
      authorName: item.message.sender_chat?.title ?? item.message.chat.title ?? null,
      authorHandle: item.message.sender_chat?.username ?? item.message.chat.username ?? null,
      publishedAt: new Date(item.message.date * 1000),
      ...(source ? {
        observation: observationContextForCollector(source, {
          providerItemId: String(update.update_id),
          rawPayload: { update },
          requireMatchedTerm: item.discussion && keywords.length > 0,
        }),
      } : {}),
    }
    const result = source ? await ingestMentionWithResult(input) : { id: "", created: await ingestMention(input), accepted: true }
    if (result.accepted === false) ignoredCount += 1
    else if (result.created) newCount += 1
    else duplicateCount += 1
    lastEventAt = input.publishedAt
  }
  if (maxUpdateId !== offset) await saveCursor(account, maxUpdateId, lastEventAt)
  return {
    status: "success",
    foundCount,
    newCount,
    duplicateCount,
    ignoredCount,
    error: null,
    rawStats: {
      platform: "telegram",
      accountId: account.id,
      offsetBefore: offset,
      offsetAfter: maxUpdateId,
      coverageClass: "COMPLETE_FOR_DELIVERED_UPDATES",
      limitation: "Only channels/discussion groups where the configured bot receives updates are covered.",
    },
  }
}

export async function runTelegramDiscussionCollector(source: MonitoringSourceForRun): Promise<MonitoringCollectorResult> {
  const settings = record(source.settings)
  const accountId = typeof settings.socialAccountId === "string" ? settings.socialAccountId : null
  const account = await prisma.socialAccount.findFirst({
    where: { organizationId: source.organizationId, platform: "telegram", isActive: true, ...(accountId ? { id: accountId } : {}) },
    orderBy: { updatedAt: "desc" },
  }) as TelegramAccount | null
  if (!account) return { status: "skipped", foundCount: 0, newCount: 0, duplicateCount: 0, ignoredCount: 0, error: "telegram_account_not_connected" }
  return scanTelegramAccount(account, source)
}

/** Compatibility entrypoint for legacy account polling; it now uses a real
 * connection-level cursor instead of a fake SocialMention sentinel. */
export async function scanTelegramForOrg(organizationId: string): Promise<{ ingested: number; error?: string }> {
  const accounts = await prisma.socialAccount.findMany({ where: { organizationId, platform: "telegram", isActive: true } }) as TelegramAccount[]
  let ingested = 0
  const errors: string[] = []
  for (const account of accounts) {
    const result = await scanTelegramAccount(account, null)
    ingested += result.newCount
    if (result.error) errors.push(result.error)
  }
  return { ingested, ...(errors.length > 0 ? { error: errors.join(",") } : {}) }
}

export async function scanAllTelegram(): Promise<{ total: number; orgs: number }> {
  const rows = await prisma.socialAccount.findMany({ where: { platform: "telegram", isActive: true }, select: { organizationId: true } })
  const orgIds = Array.from(new Set<string>(rows.map((row: { organizationId: string }) => row.organizationId)))
  let total = 0
  for (const organizationId of orgIds) total += (await scanTelegramForOrg(organizationId)).ingested
  return { total, orgs: orgIds.length }
}
