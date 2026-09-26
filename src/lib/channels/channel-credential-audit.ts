import type { NextRequest } from "next/server"
import { logAudit } from "@/lib/prisma"

/**
 * Audit trail for channel configuration — the rows that hold third-party credentials
 * (Meta App Secret, page/WhatsApp access tokens, webhook verify tokens).
 *
 * Meta's Data Handling questionnaire asks who can change an integration's credentials and how that
 * is recorded. Until this existed the honest answer was "nobody records it": `channel_configs` was
 * the one credential-bearing surface with no audit write, while 27 other routes had one.
 *
 * What is recorded is deliberately the *shape* of the change, never its content: which credential
 * fields were written, by whom, from where. A secret must not be reachable by reading the audit log
 * — that would simply move the secret to a second table and widen the blast radius of a leak. The
 * same rule applies to old values: this never stores a "before" credential either.
 */

/** Credential-bearing columns and settings keys. Only their NAMES are ever recorded. */
const CREDENTIAL_FIELDS = [
  "botToken",
  "apiKey",
  "appSecret",
  "accessToken",
  "verifyToken",
] as const

export type ChannelAuditAction = "create" | "update" | "delete" | "disconnect"

/**
 * Which credential fields a request actually carries a value for.
 *
 * A blank/absent field means "keep what is stored" on this API, so it is NOT a credential change
 * and must not be reported as one — an audit trail that cries wolf on every cosmetic rename is one
 * nobody reads.
 */
export function changedCredentialFields(body: Record<string, unknown> | null | undefined): string[] {
  if (!body || typeof body !== "object") return []
  return CREDENTIAL_FIELDS.filter((f) => {
    const v = body[f]
    return typeof v === "string" && v.trim().length > 0
  })
}

/**
 * Record a channel-configuration change.
 *
 * Never throws: an audit write must not roll back a channel change the admin has already been told
 * succeeded. A failure is logged so it is visible in the process log rather than silently absent.
 */
export async function auditChannelChange(params: {
  req: NextRequest
  orgId: string
  userId: string
  action: ChannelAuditAction
  channelId: string
  channelType: string
  configName?: string | null
  credentialFields?: string[]
}): Promise<void> {
  try {
    await logAudit(
      params.orgId,
      params.action,
      "channel_config",
      params.channelId,
      params.configName || params.channelType,
      {
        userId: params.userId,
        ipAddress: params.req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined,
        userAgent: params.req.headers.get("user-agent") || undefined,
        // Field NAMES only. See the header comment: no credential value, old or new, is recorded.
        newValue: {
          channelType: params.channelType,
          credentialFieldsChanged: params.credentialFields ?? [],
        },
      },
    )
  } catch (e) {
    console.error("[channel-audit] failed to record channel change", e)
  }
}
