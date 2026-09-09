import { prisma } from "@/lib/prisma"

/**
 * Backfill EXISTING Facebook Messenger / Instagram Direct conversations into the inbox.
 *
 * The webhook (/api/v1/webhooks/facebook) only captures NEW messages from the moment a page is
 * subscribed — historical threads are never delivered. This module pulls them via the Graph
 * Conversations API and writes the same SocialConversation + ChannelMessage rows the webhook does, so
 * a tenant's existing DM history shows up in their inbox.
 *
 * - Facebook Messenger:  GET /{page-id}/conversations
 * - Instagram Direct:    GET /{page-id}/conversations?platform=instagram   (same Page id + token)
 *
 * Idempotent: every message carries its Graph `mid` in metadata; re-running skips already-imported
 * mids. Historical import does NOT inflate unreadCount (that's for live notifications only).
 *
 * SECURITY: page tokens are sent in the Authorization header, not in URLs or pagination logs.
 */
const GRAPH = process.env.META_GRAPH_BASE || "https://graph.facebook.com/v21.0"
const MAX_CONVERSATIONS = 300 // safety cap per page+platform; logged when hit (no silent truncation)
const MSG_PER_CONV = 50 // most-recent N messages per thread in slice-1 (deeper paging = follow-up)
const MAX_PAGES = 20 // conversation-list pages to walk

export type ImportResult = {
  platform: "facebook" | "instagram"
  configName: string
  conversations: number
  messages: number
  capped: boolean
  error?: string
}

type GraphMsg = {
  id?: string
  message?: string
  created_time?: string
  from?: { id?: string; name?: string }
  attachments?: { data?: Array<{ image_data?: { url?: string }; file_url?: string; mime_type?: string }> }
}
type GraphConv = {
  participants?: { data?: Array<{ id?: string; name?: string }> }
  messages?: { data?: GraphMsg[] }
}
type GraphPage = { data?: GraphConv[]; paging?: { next?: string }; error?: { message?: string } }

function graphAuthInit(pageToken: string): RequestInit {
  return {
    headers: { Authorization: `Bearer ${pageToken}` },
    signal: AbortSignal.timeout(20_000),
  }
}

function stripGraphUrlCredentials(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return undefined
  try {
    const url = new URL(rawUrl)
    url.searchParams.delete("access_token")
    url.searchParams.delete("appsecret_proof")
    return url.toString()
  } catch {
    return undefined
  }
}

/**
 * Import one page's conversations for one platform.
 * @param ourIds ids that represent US (the page id and/or linked IG account id) → outbound when `from` matches
 */
export async function importPageConversations(
  orgId: string,
  pageId: string,
  pageToken: string,
  platform: "facebook" | "instagram",
  channelConfigId: string,
  configName: string,
  ourIds: string[],
): Promise<ImportResult> {
  const out: ImportResult = { platform, configName, conversations: 0, messages: 0, capped: false }
  if (!orgId || !pageId || !pageToken) {
    out.error = "missing org/page/token"
    return out
  }
  const platformParam = platform === "instagram" ? "&platform=instagram" : ""
  const fields =
    `id,updated_time,participants,messages.limit(${MSG_PER_CONV})` +
    `{id,message,created_time,from,attachments{image_data,file_url,mime_type}}`
  let url:
    | string
    | undefined = `${GRAPH}/${encodeURIComponent(pageId)}/conversations?fields=${encodeURIComponent(fields)}&limit=50${platformParam}`

  try {
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const res = await fetch(url, graphAuthInit(pageToken))
      const data = (await res.json().catch(() => ({}))) as GraphPage
      if (!res.ok || data.error) {
        out.error = data.error?.message || `HTTP ${res.status}`
        return out
      }
      for (const conv of data.data || []) {
        if (out.conversations >= MAX_CONVERSATIONS) {
          out.capped = true
          break
        }
        const imported = await importOneConversation(orgId, platform, channelConfigId, pageId, ourIds, conv)
        if (imported) {
          out.conversations++
          out.messages += imported
        }
      }
      if (out.capped) break
      url = stripGraphUrlCredentials(data.paging?.next)
    }
  } catch (e) {
    out.error = e instanceof Error ? e.message : "fetch failed"
  }
  return out
}

/** Returns the number of NEW messages imported for this conversation (0 if none/skipped). */
async function importOneConversation(
  orgId: string,
  platform: "facebook" | "instagram",
  channelConfigId: string,
  pageId: string,
  ourIds: string[],
  conv: GraphConv,
): Promise<number> {
  const participants = conv.participants?.data || []
  // The customer is the participant that isn't us. Fall back to the first participant.
  const customer = participants.find((p) => p.id && !ourIds.includes(p.id)) || participants[0]
  if (!customer?.id) return 0

  // find-or-create the conversation WITHOUT inflating unreadCount (historical import is not "unread")
  let sc = await prisma.socialConversation.findUnique({
    where: { organizationId_platform_externalId: { organizationId: orgId, platform, externalId: customer.id } },
  })
  if (!sc) {
    sc = await prisma.socialConversation.create({
      data: {
        organizationId: orgId,
        platform,
        externalId: customer.id,
        contactName: customer.name || customer.id,
        lastMessage: "",
        channelConfigId,
        lastMessageAt: new Date(0),
      },
    })
  }

  // dedup against anything already stored for this thread (re-run safe)
  const existing = await prisma.channelMessage.findMany({
    where: { conversationId: sc.id },
    select: { metadata: true },
  })
  const seen = new Set(
    existing
      .map((m: { metadata: unknown }) => (m.metadata as { mid?: string } | null)?.mid)
      .filter((x: string | undefined): x is string => Boolean(x)),
  )

  const msgs = (conv.messages?.data || []).slice().reverse() // Graph returns newest-first → import oldest-first
  let imported = 0
  let lastBody = ""
  let lastAt: Date | null = null
  for (const msg of msgs) {
    if (msg.id && seen.has(msg.id)) continue
    const att = msg.attachments?.data?.[0]
    const mediaUrl = att?.image_data?.url || att?.file_url || null
    const body = msg.message || (mediaUrl ? "[media]" : "")
    if (!body && !mediaUrl) continue
    const outbound = Boolean(msg.from?.id && ourIds.includes(msg.from.id))
    const at = msg.created_time ? new Date(msg.created_time) : new Date()
    await prisma.channelMessage.create({
      data: {
        organizationId: orgId,
        channelConfigId,
        channelType: platform,
        direction: outbound ? "outbound" : "inbound",
        from: msg.from?.id || (outbound ? pageId : customer.id),
        to: outbound ? customer.id : pageId,
        body,
        status: "delivered",
        mediaUrl,
        messageType: mediaUrl ? "image" : "text",
        conversationId: sc.id,
        metadata: { mid: msg.id, imported: true, createdTime: msg.created_time },
        createdAt: at,
      },
    })
    imported++
    lastBody = body
    lastAt = at
  }

  if (lastAt && (!sc.lastMessageAt || lastAt > sc.lastMessageAt)) {
    await prisma.socialConversation.update({
      where: { id: sc.id },
      data: {
        lastMessage: lastBody.slice(0, 500),
        lastMessageAt: lastAt,
        // A customer who writes again undoes the delete. The thread was moved
        // to the trash by someone who had finished with it; the customer had
        // not. Leaving it deleted hides their new message from the inbox AND
        // from the trash view, so the business simply stops answering them and
        // nothing on screen says why.
        deletedAt: null,
        deletedBy: null,
      },
    })
  }
  return imported
}
