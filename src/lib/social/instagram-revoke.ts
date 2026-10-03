import { prisma, logAudit } from "@/lib/prisma"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { isIgLogin } from "@/lib/social/tenant-meta-app"

/**
 * An Instagram account owner took LeadDrive's access away on Meta's side — removed the app from
 * "Apps and websites" (Deauthorize callback) or asked for their data to be deleted (Data Deletion
 * callback). Both arrive as a signed request naming the Instagram user, not a workspace.
 *
 * What happens here is what the published data-deletion page promises for a disconnect, and what
 * the in-app Disconnect (DELETE /api/v1/channels/[id]) already does: the channel is switched off and
 * the stored token is wiped, so nothing can be read or sent for that account any more. A data
 * deletion request additionally removes the account's handle from the channel. Conversation history
 * is NOT removed here — it is the business's CRM record and the policy routes it through a reviewed
 * deletion within 30 days; the caller makes that request visible to a person.
 *
 * Only Instagram-Login rows are touched: the token being revoked was issued by the Instagram-Login
 * app. A Facebook-Login row for the same account holds a Page token from a different app and is
 * unaffected by this revocation.
 */
export type InstagramRevokeReason = "deauthorize" | "data_deletion"

export type RevokedInstagramChannel = { id: string; organizationId: string }

type CandidateRow = {
  id: string
  organizationId: string
  pageId: string | null
  configName: string | null
  settings: unknown
}

function settingsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {}
}

/**
 * Meta names the user by an id we may have stored under either of two names: `pageId` is the
 * professional account id (`user_id` of GET /me) and `settings.igScopedId` the app-scoped id (`id`
 * of GET /me). Both are matched so the revocation lands whichever one Meta sends.
 */
function namesUser(row: CandidateRow, igUserId: string): boolean {
  if (row.pageId === igUserId) return true
  return settingsRecord(row.settings).igScopedId === igUserId
}

export async function revokeInstagramLoginAccount(
  igUserId: string,
  reason: InstagramRevokeReason,
  confirmationCode?: string,
): Promise<RevokedInstagramChannel[]> {
  if (!igUserId) return []
  // The lookup IS the org resolution (an Instagram user id is an external identifier) → bypass scope.
  const candidates: CandidateRow[] = await runWithRlsBypass(() =>
    prisma.channelConfig.findMany({
      where: {
        channelType: "instagram",
        OR: [{ pageId: igUserId }, { settings: { path: ["igScopedId"], equals: igUserId } }],
      },
      select: { id: true, organizationId: true, pageId: true, configName: true, settings: true },
    }),
  )
  const rows = (Array.isArray(candidates) ? candidates : []).filter(
    (row) => isIgLogin(row.settings) && namesUser(row, igUserId),
  )

  const revoked: RevokedInstagramChannel[] = []
  const at = new Date().toISOString()
  for (const row of rows) {
    await runWithTenant(row.organizationId, async () => {
      const settings = settingsRecord(row.settings)
      settings.inboxSubscribed = false
      delete settings.subscriptionPending
      settings.revokedByMeta = { reason, at, ...(confirmationCode ? { confirmationCode } : {}) }
      let configName = row.configName
      if (reason === "data_deletion") {
        delete settings.username
        configName = "Instagram account (data deletion requested)"
      }
      await prisma.channelConfig.updateMany({
        where: { id: row.id, organizationId: row.organizationId },
        data: { isActive: false, apiKey: null, accessToken: null, configName, settings },
      })
      await prisma.channelConnection.updateMany({
        where: { organizationId: row.organizationId, channelConfigId: row.id },
        data: { status: "disabled", apiKey: null, accessToken: null, refreshToken: null, secretRef: null },
      })
      // Field NAMES only, as for every channel credential change (lib/channels/channel-credential-audit).
      await logAudit(
        row.organizationId,
        reason === "deauthorize" ? "disconnect" : "data_deletion_request",
        "channel_config",
        row.id,
        configName || "instagram",
        {
          newValue: {
            channelType: "instagram",
            source: reason === "deauthorize" ? "meta_deauthorize_callback" : "meta_data_deletion_callback",
            credentialFieldsChanged: ["apiKey", "accessToken"],
            ...(confirmationCode ? { confirmationCode } : {}),
          },
        },
      ).catch((e: unknown) => console.error("[instagram-revoke] audit write failed", e))
    })
    revoked.push({ id: row.id, organizationId: row.organizationId })
  }
  return revoked
}
