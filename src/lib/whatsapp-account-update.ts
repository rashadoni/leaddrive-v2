/**
 * When Meta says a connected WhatsApp number is no longer ours.
 *
 * A number shared through Embedded Signup can leave without anyone telling the workspace: in
 * coexistence Meta disconnects it when the owner's phone has been idle «approximately 14 days»
 * (`PRIMARY_INACTIVITY`), when they change phone or re-register (`USER_RE_REGISTERED`,
 * `CHANGE_NUMBER`), when they register the number in the consumer WhatsApp app
 * (`BUSINESS_DOWNGRADE`), or because they tapped **Disconnect Account** in the app themselves. And
 * the Deregister API does not work on such a number, so the only notice we ever get is this webhook.
 *
 * Two different situations, and conflating them is the trap:
 *
 *   • `ACCOUNT_OFFBOARDED` is TEMPORARY. Meta's own guidance is to «pause any pending Cloud API
 *     message sends for this client, as they fail while reonboarding is in progress», and
 *     reonboarding runs by itself, «typically within a few minutes», ending in
 *     `ACCOUNT_RECONNECTED`. So the row must stay active: deactivating it would also stop the
 *     webhook lookup — which needs `isActive: true` — and we would never see the reconnect.
 *
 *   • `PARTNER_REMOVED` / `ACCOUNT_DELETED` is the number LEAVING. Here the row is deactivated:
 *     every send would fail anyway, and a reconnect goes through Embedded Signup, which writes this
 *     same row again with `isActive: true`.
 *
 * Why the paused state matters beyond tidiness: without it the booking agent and the reminder job
 * keep trying, and a reminder that fails is retried on every run — the pause turns a storm of
 * rejected sends into one honest «not available right now».
 */
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { sanitizeLog } from "@/lib/sanitize"

/** Lifecycle events we act on. Everything else is logged and left alone. */
const PAUSE_EVENTS = new Set(["ACCOUNT_OFFBOARDED"])
const RESUME_EVENTS = new Set(["ACCOUNT_RECONNECTED", "PARTNER_ADDED"])
const DISCONNECT_EVENTS = new Set(["PARTNER_REMOVED", "ACCOUNT_DELETED"])

export type WaAccountUpdateValue = {
  event?: unknown
  waba_info?: { waba_id?: unknown; owner_business_id?: unknown }
  disconnection_info?: { reason?: unknown; initiated_by?: unknown }
}

export type AccountUpdateAction = "paused" | "resumed" | "disconnected" | "ignored" | "unknown_account"

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function settingsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {}
}

/**
 * The channel this event is about.
 *
 * `account_update` carries no `metadata.phone_number_id` — it is addressed by the Messaging account
 * id in `entry.id` — so the row is found by `businessAccountId`. Deactivated rows are included on
 * purpose: a reconnect has to be able to find the row it is reviving.
 */
async function resolveAccountChannels(wabaId: string) {
  if (!wabaId) return []
  // RLS: resolution by an external identifier (Messaging account id) is the cross-tenant phase.
  return runWithRlsBypass(() =>
    prisma.channelConfig.findMany({
      where: { channelType: "whatsapp", OR: [{ businessAccountId: wabaId }, { webhookUrl: wabaId }] },
      select: { id: true, organizationId: true, settings: true, isActive: true },
    }),
  )
}

/**
 * Apply one `account_update` payload.
 *
 * Returns what was done so the caller can log it; never throws for an unknown event — an
 * unrecognised lifecycle event must not cost us the rest of the webhook batch.
 */
export async function applyWhatsAppAccountUpdate(params: {
  wabaId: string | null
  value: WaAccountUpdateValue
  now?: Date
}): Promise<{ action: AccountUpdateAction; channels: number; event: string | null }> {
  const event = str(params.value.event)
  const wabaId = params.wabaId || str(params.value.waba_info?.waba_id) || ""
  const now = params.now ?? new Date()
  if (!event) return { action: "ignored", channels: 0, event: null }

  const interesting = PAUSE_EVENTS.has(event) || RESUME_EVENTS.has(event) || DISCONNECT_EVENTS.has(event)
  if (!interesting) {
    console.log(`[WA Account] ${sanitizeLog(event)} for waba=${sanitizeLog(wabaId)} — no action`)
    return { action: "ignored", channels: 0, event }
  }

  const channels = await resolveAccountChannels(wabaId)
  if (channels.length === 0) {
    console.warn(`[WA Account] ${sanitizeLog(event)} for unknown waba=${sanitizeLog(wabaId)}`)
    return { action: "unknown_account", channels: 0, event }
  }

  const reason = str(params.value.disconnection_info?.reason)
  const initiatedBy = str(params.value.disconnection_info?.initiated_by)
  const action: AccountUpdateAction = DISCONNECT_EVENTS.has(event)
    ? "disconnected"
    : PAUSE_EVENTS.has(event)
      ? "paused"
      : "resumed"

  for (const channel of channels) {
    const settings = settingsRecord(channel.settings)
    if (action === "disconnected") {
      settings.cloudApiPaused = false
      settings.disconnected = {
        at: now.toISOString(),
        event,
        ...(reason ? { reason } : {}),
        ...(initiatedBy ? { initiatedBy } : {}),
      }
    } else if (action === "paused") {
      // The flag every send path reads through resolveWhatsAppConfig.
      settings.cloudApiPaused = true
      settings.cloudApiPausedAt = now.toISOString()
      settings.cloudApiPausedEvent = event
    } else {
      settings.cloudApiPaused = false
      delete settings.cloudApiPausedAt
      delete settings.cloudApiPausedEvent
      delete settings.disconnected
    }

    // RLS: the row was resolved across tenants above; the write stays pinned to that exact row id.
    await runWithRlsBypass(() =>
      prisma.channelConfig.update({
        where: { id: channel.id },
        data: {
          settings: settings as never,
          // Only ever switched OFF here. Turning a channel back on is a decision — the workspace's
          // own switch in Settings → Channels, or a fresh Embedded Signup — and a reconnect webhook
          // must not revive a row an administrator deliberately disabled.
          ...(action === "disconnected" ? { isActive: false } : {}),
        },
      }),
    ).catch((error) => {
      console.error(`[WA Account] could not apply ${sanitizeLog(event)} to channel ${sanitizeLog(channel.id)}:`, error)
    })
  }

  console.log(
    `[WA Account] ${sanitizeLog(event)} → ${action} for waba=${sanitizeLog(wabaId)}`
    + ` channels=${channels.length}${reason ? ` reason=${sanitizeLog(reason)}` : ""}`,
  )
  return { action, channels: channels.length, event }
}

/** Is this channel's Cloud API side paused by Meta right now? */
export function isCloudApiPaused(settings: unknown): boolean {
  return settingsRecord(settings).cloudApiPaused === true
}
