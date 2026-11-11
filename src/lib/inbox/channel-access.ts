/**
 * Which of the organization's numbers and pages one person may see in the inbox.
 *
 * Owner, 2026-11-11: «в омни канале сделать разрешения… какой-то пользователь может видеть те или
 * иные страницы, которые другой не должен видеть» → «номера и страницы» → macket approved «Давай».
 * An admin unticks a WhatsApp number or a Facebook page on the user's card; that person then does
 * not get its conversations anywhere — not in the list, not by a direct link, not as a reply target,
 * not in the counters.
 *
 * `User.hiddenChannelConfigIds` is a DENY list, like `hiddenModules`: empty means every channel, so
 * nobody loses access on deploy, and a channel connected later is visible until someone unticks it.
 * Admin and superadmin are never narrowed, and an API key acts as the organization.
 *
 * The list travels with the session (api-auth `hiddenChannelConfigIds`), which auth() rebuilds from
 * the user row on every request — an untick takes effect on the person's next request.
 */

import { NextResponse, type NextRequest } from "next/server"
import type { AuthResult } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

export type ChannelAccessPrincipal = {
  orgId: string
  userId: string
  role: string
  principalType?: "session" | "api_key"
  /** Carried by the session (api-auth), re-read from the user row on every request by auth(). */
  hiddenChannelConfigIds?: readonly string[]
}

/** The person the rule never narrows. */
function seesEverything(auth: ChannelAccessPrincipal): boolean {
  return auth.role === "admin" || auth.role === "superadmin" || auth.principalType === "api_key"
}

/**
 * The channels this person may not see; empty for everyone the rule does not narrow. Read from the
 * session, which auth() rebuilds from the user row on every request — so an untick takes effect on
 * the person's next request, at no extra query.
 */
export async function hiddenChannelIdsFor(auth: ChannelAccessPrincipal): Promise<ReadonlySet<string>> {
  if (seesEverything(auth)) return new Set()
  return new Set((auth.hiddenChannelConfigIds ?? []).filter((id) => typeof id === "string" && id))
}

/** A message, call or conversation on `channelConfigId` — visible? One with no channel stays visible. */
export function channelVisible(hidden: ReadonlySet<string>, channelConfigId: string | null | undefined): boolean {
  return !channelConfigId || !hidden.has(channelConfigId)
}

/**
 * A Prisma `where` fragment that keeps only rows on visible channels (rows without a channel stay).
 * `undefined` when nothing is hidden, so the query is exactly what it was before.
 */
export function visibleChannelWhere(hidden: ReadonlySet<string>): Record<string, unknown> | undefined {
  if (hidden.size === 0) return undefined
  return { OR: [{ channelConfigId: null }, { channelConfigId: { notIn: [...hidden] } }] }
}

/**
 * For a route about one conversation: a 404 when it sits on a channel hidden from this person,
 * null to go on. «Not found» rather than «forbidden», so a hidden number does not confirm its
 * conversations exist. An id that is not a stored conversation passes through — the route itself
 * answers for it.
 */
export async function conversationAccessDenial(
  auth: ChannelAccessPrincipal,
  conversationId: string | null | undefined,
): Promise<NextResponse | null> {
  if (!conversationId) return null
  const hidden = await hiddenChannelIdsFor(auth)
  if (hidden.size === 0) return null
  const conversation = await prisma.socialConversation.findFirst({
    where: { id: conversationId, organizationId: auth.orgId },
    select: { channelConfigId: true },
  })
  if (conversation && !channelVisible(hidden, conversation.channelConfigId)) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 })
  }
  return null
}

/**
 * Wraps a route about one conversation (`…/conversations/[id]/…`): the conversation's channel is
 * checked before the handler runs. It sits inside the auth wrapper, so it sees the whole auth
 * object whatever the handler itself destructures. `inbox-channel-access-guard.test.ts` fails when
 * a route under that path is not wrapped.
 */
export function withConversationChannelAccess<C extends { params: Promise<{ id: string }> }>(
  handler: (req: NextRequest, auth: AuthResult, ctx: C) => Promise<Response> | Response,
) {
  return async (req: NextRequest, auth: AuthResult, ctx: C): Promise<Response> => {
    const { id } = await ctx.params
    const denied = await conversationAccessDenial(auth, id)
    if (denied) return denied
    return handler(req, auth, ctx)
  }
}
