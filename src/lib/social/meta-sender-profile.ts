import { prisma } from "@/lib/prisma"

/**
 * Display name for an inbound Meta DM sender (Instagram Direct / Messenger).
 *
 * Webhook payloads carry only the page-scoped sender id (IGSID / PSID), so without this the inbox
 * shows a 16-digit number where the customer's @username belongs. Meta's User Profile API returns
 * the name for anyone who has messaged the page/account:
 *  - Instagram via a Facebook-Login page token → graph.facebook.com/{igsid}?fields=name,username
 *  - Instagram via an Instagram-Login token     → graph.instagram.com/{igsid}?fields=name,username
 *  - Messenger via a page token                  → graph.facebook.com/{psid}?fields=name
 *
 * Runs inside the webhook, so it must never throw or stall the 200 owed to Meta: bounded timeout,
 * every failure falls back to the sender id (the previous behaviour). A name already resolved on the
 * conversation is kept without a Graph call — upsertSocialConversation overwrites contactName on
 * every inbound message, so returning the raw id on a later failed lookup would erase it.
 * Must be called inside the tenant's RLS scope (the conversation read is tenant-scoped).
 */
const FB_GRAPH = "https://graph.facebook.com/v20.0"
const IG_GRAPH = "https://graph.instagram.com/v21.0"
const LOOKUP_TIMEOUT_MS = 3000

export async function resolveMetaSenderName(opts: {
  organizationId: string
  platform: "facebook" | "instagram"
  senderId: string
  token: string | null | undefined
  igLogin: boolean
}): Promise<string> {
  const { organizationId, platform, senderId, token, igLogin } = opts

  let existing: { contactName: string | null } | null = null
  try {
    existing = await prisma.socialConversation.findUnique({
      where: { organizationId_platform_externalId: { organizationId, platform, externalId: senderId } },
      select: { contactName: true },
    })
  } catch {
    existing = null
  }
  const known = existing?.contactName?.trim()
  if (known && known !== senderId) return known

  if (!token) return senderId
  const url =
    platform === "instagram"
      ? `${igLogin ? IG_GRAPH : FB_GRAPH}/${encodeURIComponent(senderId)}?fields=name,username`
      : `${FB_GRAPH}/${encodeURIComponent(senderId)}?fields=name`
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    })
    if (!res.ok) {
      console.warn(`[meta-sender-profile] ${platform} lookup failed (${res.status}) for sender ${senderId}`)
      return senderId
    }
    const data = (await res.json().catch(() => null)) as { name?: unknown; username?: unknown } | null
    const username = typeof data?.username === "string" ? data.username.trim() : ""
    const name = typeof data?.name === "string" ? data.name.trim() : ""
    if (username) return `@${username}`
    return name || senderId
  } catch (e) {
    console.warn(`[meta-sender-profile] ${platform} lookup error for sender ${senderId}:`, (e as Error)?.message)
    return senderId
  }
}
