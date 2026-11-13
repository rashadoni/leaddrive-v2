/**
 * Replies the team typed in the Instagram app BEFORE the webhook kept them (2026-11-13).
 *
 * From that day lib/inbox/meta-dm-app-echo stores every such reply as it happens. The ones written
 * earlier exist only in Instagram, so the CRM threads of those days still look unanswered (Zeytun
 * Pharma, 11–13 Nov; owner: «Да, дотяни»). This reads the account's own conversations through the
 * Instagram-Login API and hands each message the account sent to the SAME ingester the webhook
 * uses — so a reply that went out from the CRM is recognised and not written twice, and running it
 * again changes nothing.
 *
 * Only Instagram-Login channels (graph.instagram.com). Customer messages are not touched: the
 * webhook has been storing those all along.
 */
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { ingestMetaDmEcho, type MetaDmEchoChannel } from "@/lib/inbox/meta-dm-app-echo"
import { isIgLogin } from "@/lib/social/tenant-meta-app"
import { redactOAuthProviderText } from "@/lib/oauth-redaction"

const IG_GRAPH = "https://graph.instagram.com/v21.0"
const PAGE_SIZE = 25
const MESSAGES_PER_CONVERSATION = 50
const MAX_PAGES = 40
/** History further back than this is not what this tool is for. */
export const BACKFILL_MAX_DAYS = 14

type GraphAttachment = {
  image_data?: { url?: string }
  video_data?: { url?: string }
  file_url?: string
}
type GraphMessage = {
  id?: string
  created_time?: string
  from?: { id?: string }
  to?: { data?: Array<{ id?: string }> }
  message?: string
  attachments?: { data?: GraphAttachment[] }
  is_unsupported?: boolean
}
type GraphConversation = {
  updated_time?: string
  participants?: { data?: Array<{ id?: string }> }
  messages?: { data?: GraphMessage[] }
}
type GraphPage = { data?: GraphConversation[]; paging?: { next?: string }; error?: { message?: string } }

export type AppRepliesBackfillReport = {
  dryRun: boolean
  since: string
  channels: number
  conversations: number
  /** Messages the account sent in the period. */
  accountMessages: number
  /** Written (or, in a dry run, would be written) as a reply from the app. */
  stored: number
  /** Already in the CRM: sent from it, or stored by the webhook or an earlier run. */
  alreadyKnown: number
  skipped: number
  errors: string[]
}

/** The webhook's attachment shape, which is what the ingester reads. */
function attachmentsOf(message: GraphMessage): Array<{ type: string; payload: { url: string } }> | undefined {
  const first = message.attachments?.data?.[0]
  if (!first) return undefined
  if (first.image_data?.url) return [{ type: "image", payload: { url: first.image_data.url } }]
  if (first.video_data?.url) return [{ type: "video", payload: { url: first.video_data.url } }]
  if (first.file_url) return [{ type: "file", payload: { url: first.file_url } }]
  return undefined
}

async function backfillChannel(
  channel: MetaDmEchoChannel & { apiKey: string; pageId: string },
  since: Date,
  dryRun: boolean,
  report: AppRepliesBackfillReport,
  fetchImpl: typeof fetch,
): Promise<void> {
  const fields =
    `updated_time,participants,messages.limit(${MESSAGES_PER_CONVERSATION})`
    + "{id,created_time,from,to,message,attachments,is_unsupported}"
  let url: string | undefined =
    `${IG_GRAPH}/me/conversations?platform=instagram&limit=${PAGE_SIZE}&fields=${encodeURIComponent(fields)}`
    + `&access_token=${encodeURIComponent(channel.apiKey)}`

  for (let page = 0; url && page < MAX_PAGES; page += 1) {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) })
    const data = (await res.json().catch(() => ({}))) as GraphPage
    if (!res.ok || data.error) {
      report.errors.push(redactOAuthProviderText(`channel ${channel.id}: ${data.error?.message || `HTTP ${res.status}`}`))
      return
    }
    let reachedOlder = false
    for (const conversation of data.data ?? []) {
      // Conversations come newest first; one untouched since the start of the period ends the walk.
      const updated = conversation.updated_time ? new Date(conversation.updated_time) : null
      if (updated && updated < since) {
        reachedOlder = true
        break
      }
      report.conversations += 1
      const customer = conversation.participants?.data?.find((p) => p.id && p.id !== channel.pageId)?.id
      // Oldest first, so each reply lands after the one before it and the thread's last line is right.
      const messages = (conversation.messages?.data ?? []).slice().reverse()
      for (const message of messages) {
        if (message.from?.id !== channel.pageId || !message.id || !message.created_time) continue
        const at = new Date(message.created_time)
        if (!(at >= since)) continue
        report.accountMessages += 1
        const recipientId = message.to?.data?.find((p) => p.id && p.id !== channel.pageId)?.id ?? customer
        const outcome = await ingestMetaDmEcho({
          channel,
          platform: "instagram",
          accountId: channel.pageId,
          historical: true,
          dryRun,
          event: {
            sender: { id: channel.pageId },
            recipient: { id: recipientId },
            timestamp: at.getTime(),
            message: { mid: message.id, text: message.message || undefined, is_echo: true, attachments: attachmentsOf(message) },
          },
        })
        if (outcome === "stored") report.stored += 1
        else if (outcome === "skipped") report.skipped += 1
        else report.alreadyKnown += 1
      }
    }
    if (reachedOlder) return
    url = data.paging?.next
  }
}

/**
 * One organisation, from `since` to now. Without `apply` nothing is written and the counts say
 * what would be.
 */
export async function backfillInstagramAppReplies(options: {
  organizationId: string
  since: Date
  dryRun: boolean
  fetchImpl?: typeof fetch
}): Promise<AppRepliesBackfillReport> {
  const { organizationId, since, dryRun } = options
  const report: AppRepliesBackfillReport = {
    dryRun, since: since.toISOString(), channels: 0, conversations: 0,
    accountMessages: 0, stored: 0, alreadyKnown: 0, skipped: 0, errors: [],
  }
  const configs = await runWithRlsBypass(() =>
    prisma.channelConfig.findMany({
      where: { organizationId, channelType: "instagram", isActive: true },
      select: { id: true, organizationId: true, apiKey: true, pageId: true, settings: true },
      orderBy: { createdAt: "asc" },
    }),
  )
  for (const config of configs) {
    if (!config.apiKey || !config.pageId || !isIgLogin(config.settings)) continue
    report.channels += 1
    const channel = { ...config, apiKey: config.apiKey, pageId: config.pageId }
    try {
      await runWithTenant(organizationId, () =>
        backfillChannel(channel, since, dryRun, report, options.fetchImpl ?? fetch),
      )
    } catch (error) {
      report.errors.push(redactOAuthProviderText(`channel ${config.id}: ${error instanceof Error ? error.message : "failed"}`))
    }
  }
  return report
}
