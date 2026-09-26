import { prisma } from "@/lib/prisma"
import { normalizeOAuthReturnChannelId, oauthReturnChannelType } from "./oauth-return"

/**
 * Resolve the row a Meta connect was started from (`?channelId=` on the start route, `channelId` in
 * the signed state on the callback) to an id the channel card may open — or null.
 *
 * The id arrives from the browser, so it proves nothing on its own: it must name a row of THIS
 * organization and of the type the return card edits. Anything else — another tenant's row, a
 * deleted row, an Instagram row handed to the Facebook card — is dropped, and the card then shows
 * the neutral summary instead of a form. Dropping, not failing: a missing return id costs a click to
 * the channel list, whereas refusing the whole connect over it would cost the connection.
 *
 * Runs inside the caller's tenant context (withSocialConnectAuth on the start routes,
 * runWithTenant on the callbacks), so RLS scopes the read as well as the explicit organizationId.
 */
export async function resolveOAuthReturnChannel(
  organizationId: string,
  returnKey: string | null | undefined,
  rawChannelId: unknown,
): Promise<string | null> {
  const channelType = oauthReturnChannelType(returnKey)
  const id = normalizeOAuthReturnChannelId(rawChannelId)
  if (!organizationId || !channelType || !id) return null
  const row = await prisma.channelConfig.findFirst({
    where: { id, organizationId, channelType },
    select: { id: true },
  })
  return row?.id ?? null
}
