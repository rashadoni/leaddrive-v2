import { pushConfigured, sendPushMessages, type PushDelivery } from "./push-send"

/**
 * Delivering one line to the phones of specific agents.
 *
 * This is the layer that knows about our data: which addresses belong to whom
 * and which of them Firebase has told us to stop using. What it must never
 * know is more than one line about the customer — a push can appear on a
 * locked screen in front of the doctor the agent came to see, so the text is
 * the manager's own subject, and everything else waits behind the tap.
 *
 * Every call site treats this as fire-and-forget: a push that did not go out
 * must never fail the action that caused it. A manager's message is sent when
 * it is written to the database, not when Google acknowledges it.
 */

export interface PushTokenRow {
  token: string
}

export interface PushNotifyClient {
  mtmDeviceToken: {
    findMany(args: unknown): Promise<PushTokenRow[]>
    updateMany(args: unknown): Promise<{ count: number }>
  }
}

export interface NotifyAgentsInput {
  client: PushNotifyClient
  organizationId: string
  agentIds: readonly string[]
  title: string
  body: string
  /** Small routing hints the app reads when the push is tapped. */
  data?: Record<string, string>
  /** Injected in tests. */
  send?: typeof sendPushMessages
  configured?: boolean
}

export interface NotifyAgentsResult {
  sent: number
  failed: number
  retired: number
}

/** One line is enough on a lock screen, and it is all that belongs there. */
export const PUSH_BODY_LIMIT = 160

export function pushBody(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  return normalized.length > PUSH_BODY_LIMIT ? `${normalized.slice(0, PUSH_BODY_LIMIT - 1)}…` : normalized
}

export async function notifyAgents(input: NotifyAgentsInput): Promise<NotifyAgentsResult> {
  const empty: NotifyAgentsResult = { sent: 0, failed: 0, retired: 0 }
  const agentIds = [...new Set(input.agentIds.filter(Boolean))]
  if (agentIds.length === 0) return empty
  const configured = input.configured ?? pushConfigured()
  // Nothing is loaded when push is off: no query, no addresses in memory.
  if (!configured) return empty

  const rows = await input.client.mtmDeviceToken.findMany({
    where: {
      organizationId: input.organizationId,
      agentId: { in: agentIds },
      disabledAt: null,
    },
    select: { token: true },
  })
  const tokens = [...new Set(rows.map((row) => row.token).filter(Boolean))]
  if (tokens.length === 0) {
    /**
     * Usually true and unremarkable: an agent without the app has no address.
     * It is logged anyway because the other way to get here is a read that
     * returned nothing — RLS is fail-closed, so a lost tenant context is
     * silently indistinguishable from "nobody installed it". One line with a
     * count tells the two apart later.
     */
    console.info("[mtm/push] no address for these agents — agents=%d", agentIds.length)
    return empty
  }

  const send = input.send ?? sendPushMessages
  const deliveries: PushDelivery[] = await send({
    messages: tokens.map((token) => ({
      token,
      title: input.title,
      body: pushBody(input.body),
      data: input.data,
    })),
  })

  const retire = deliveries.filter((delivery) => !delivery.ok && delivery.retire).map((delivery) => delivery.token)
  if (retire.length > 0) {
    // Firebase says these addresses are gone: keep the row, stop using it.
    await input.client.mtmDeviceToken.updateMany({
      where: { organizationId: input.organizationId, token: { in: retire } },
      data: { disabledAt: new Date() },
    })
  }

  const result: NotifyAgentsResult = {
    sent: deliveries.filter((delivery) => delivery.ok).length,
    failed: deliveries.filter((delivery) => !delivery.ok).length,
    retired: retire.length,
  }

  /**
   * One line when a round delivered nothing.
   *
   * Everything above is fire-and-forget by design, and the call sites catch
   * only a throw — so a push that Google refuses used to leave no trace at
   * all. That is the worst shape a failure can take here: the manager sees
   * the message saved, the agent's phone stays silent, and nobody can tell
   * whether it was the phone, the address or the server. Counts and an error
   * code carry no customer data and are exactly what the next person needs.
   */
  if (result.sent === 0 && result.failed > 0) {
    const firstError = deliveries.find((delivery) => !delivery.ok && "error" in delivery)
    console.warn(
      "[mtm/push] nothing delivered — addresses=%d failed=%d retired=%d firstError=%s",
      tokens.length,
      result.failed,
      result.retired,
      firstError && !firstError.ok ? firstError.error : "unknown",
    )
  }

  return result
}
