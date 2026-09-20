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
  if (tokens.length === 0) return empty

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

  return {
    sent: deliveries.filter((delivery) => delivery.ok).length,
    failed: deliveries.filter((delivery) => !delivery.ok).length,
    retired: retire.length,
  }
}
