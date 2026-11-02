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
 * When Meta refuses that (Messenger did on prod, 400), the name is read from the conversation's participants
 * instead — see nameFromConversation.
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

type GraphError = { code?: unknown; error_subcode?: unknown; type?: unknown; message?: unknown }

/** One bounded Graph GET. Returns the JSON body, or null after logging why (Meta's error carries no profile data). */
async function graphGet(url: string, token: string, what: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    })
    if (!res.ok) {
      // The status alone ("400") cannot tell a missing permission from a token problem; Meta's
      // error code/subcode/message can.
      const err = ((await res.json().catch(() => null)) as { error?: GraphError } | null)?.error
      const detail = err
        ? ` code=${String(err.code ?? "?")} subcode=${String(err.error_subcode ?? "-")} type=${String(err.type ?? "?")}: ${String(err.message ?? "").slice(0, 200)}`
        : ""
      console.warn(`[meta-sender-profile] ${what} failed (${res.status})${detail}`)
      return null
    }
    return (await res.json().catch(() => null)) as Record<string, unknown> | null
  } catch (e) {
    console.warn(`[meta-sender-profile] ${what} error:`, (e as Error)?.message)
    return null
  }
}

function displayName(person: { name?: unknown; username?: unknown } | null | undefined): string | null {
  const username = typeof person?.username === "string" ? person.username.trim() : ""
  if (username) return `@${username}`
  const name = typeof person?.name === "string" ? person.name.trim() : ""
  return name || null
}

/**
 * Fallback: the sender as a participant of the conversation with the page / IG account. Meta refused the User
 * Profile call for every Messenger sender on prod (2026-09-21, five lookups, all 400): the profile fields need a
 * feature our app has no Advanced Access to. The Conversations edge needs only the messaging permission the
 * channel already works with — the history import (lib/social/import-conversations) reads names the same way.
 */
async function nameFromConversation(opts: {
  platform: "facebook" | "instagram"
  senderId: string
  token: string
  igLogin: boolean
  accountId: string | null | undefined
}): Promise<string | null> {
  const { platform, senderId, token, igLogin, accountId } = opts
  const params = new URLSearchParams({
    platform: platform === "instagram" ? "instagram" : "messenger",
    user_id: senderId,
    fields: "participants",
  })
  let base: string
  if (igLogin) base = `${IG_GRAPH}/me/conversations`
  else if (accountId) base = `${FB_GRAPH}/${encodeURIComponent(accountId)}/conversations`
  else return null
  const body = await graphGet(`${base}?${params.toString()}`, token, `${platform} conversation lookup for sender ${senderId}`)
  const conversations = Array.isArray(body?.data) ? (body!.data as Array<{ participants?: { data?: unknown } }>) : []
  for (const conversation of conversations) {
    const people = Array.isArray(conversation?.participants?.data)
      ? (conversation.participants!.data as Array<{ id?: unknown; name?: unknown; username?: unknown }>)
      : []
    const sender = people.find((person) => String(person?.id ?? "") === senderId)
    const name = displayName(sender)
    if (name) return name
  }
  return null
}

export async function resolveMetaSenderName(opts: {
  organizationId: string
  platform: "facebook" | "instagram"
  senderId: string
  token: string | null | undefined
  igLogin: boolean
  /** The channel's page id (Messenger) or IG account id — where the conversation fallback asks. */
  accountId?: string | null
}): Promise<string> {
  const { organizationId, platform, senderId, token, igLogin, accountId } = opts

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
  const profile = displayName(await graphGet(url, token, `${platform} lookup for sender ${senderId}`))
  if (profile) return profile
  return (await nameFromConversation({ platform, senderId, token, igLogin, accountId })) ?? senderId
}
