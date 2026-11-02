import { fireWebhooks } from "@/lib/webhooks"

export type WhatsAppIntegrationEvent = {
  id: string
  channelConfigId: string
  direction: "inbound" | "outbound"
  status: "received" | "sent" | "delivered" | "read" | "failed"
  contactId?: string | null
  leadId?: string | null
  conversationId?: string | null
  timestamp?: string
}

/** Stable event identity lets Make/Zapier/Sheets workflows deduplicate provider receipts.
 * Deliberate allowlist: no access token, phone, message body or provider metadata leaves here.
 * Administrators must explicitly subscribe a destination in Settings → Integrations.
 */
export async function publishWhatsAppIntegrationEvent(orgId: string, event: WhatsAppIntegrationEvent): Promise<void> {
  const received = event.direction === "inbound" && event.status === "received"
  if (!event.id || !event.channelConfigId || (!received && (event.direction !== "outbound" || event.status === "received"))) return
  try {
    await fireWebhooks(orgId, received ? "whatsapp.message_received" : "whatsapp.message_status", {
      id: `${event.id}:${event.status}`,
      messageId: event.id,
      channelConfigId: event.channelConfigId,
      direction: event.direction,
      status: event.status,
      contactId: event.contactId ?? null,
      leadId: event.leadId ?? null,
      conversationId: event.conversationId ?? null,
      timestamp: event.timestamp || new Date().toISOString(),
    }, { awaitDelivery: true })
  } catch {
    // Integration outage must not cause Meta to retry a successfully persisted inbound.
    console.warn("[WhatsApp integrations] event dispatch unavailable")
  }
}
