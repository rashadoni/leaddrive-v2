/**
 * What a WhatsApp number is for — the one choice made when the number is connected
 * (owner, 2026-11-21: «номер ватсап который подключен в омни канал … открывает тикеты в модуле
 * сервис деск. подумай как их отделить в подключении»; the two-card mock approved with «Давай»).
 *
 *   «Переписка» (`conversations`) — the number belongs to the Omni-Channel inbox, like Instagram
 *     or Telegram. No message opens, reopens or extends a Service Desk ticket, and the AI opens
 *     none either: when a person is needed it hands the conversation to the inbox team. A ticket
 *     appears only when somebody presses «Создать заявку».
 *   «Поддержка» (`support`) — every inbound text lands on a ticket of its sender's
 *     (lib/inbox/whatsapp-inbound-ticket), the AI escalates into tickets, and the ticket's status
 *     notices and survey go back over the number.
 *
 * Until this choice existed every WhatsApp number behaved as «Поддержка», with no setting at all.
 * So a number with nothing stored IS a support number: nobody's working number changes on a
 * deploy. Only a number connected from now on starts as «Переписка» — written explicitly when its
 * row is created (lib/whatsapp-embedded-signup, POST /api/v1/channels).
 *
 * The value lives in `ChannelConfig.settings.inboundPurpose` and is server-owned
 * (lib/channels/server-owned-settings): the channel form's Save can neither erase nor write it;
 * `PUT /api/v1/channels/[id]/whatsapp-purpose` is the one writer.
 *
 * No server imports here — the settings screen reads the same rule.
 */
export const WHATSAPP_INBOUND_PURPOSE_KEY = "inboundPurpose"

export const WHATSAPP_INBOUND_PURPOSES = ["conversations", "support"] as const
export type WhatsAppInboundPurpose = (typeof WHATSAPP_INBOUND_PURPOSES)[number]

/** What a number connected from now on starts as. */
export const NEW_WHATSAPP_NUMBER_PURPOSE: WhatsAppInboundPurpose = "conversations"

export function isWhatsAppInboundPurpose(value: unknown): value is WhatsAppInboundPurpose {
  return value === "conversations" || value === "support"
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** The number's purpose from its stored settings. Nothing stored — the number predates the choice: «Поддержка». */
export function whatsappInboundPurpose(settings: unknown): WhatsAppInboundPurpose {
  return asRecord(settings)[WHATSAPP_INBOUND_PURPOSE_KEY] === "conversations" ? "conversations" : "support"
}

/** Whether messages to this number become Service Desk tickets. */
export function whatsappNumberFilesTickets(settings: unknown): boolean {
  return whatsappInboundPurpose(settings) === "support"
}

/**
 * The number a WhatsApp ticket came in on (`Ticket.sourceMeta.channelConfigId`), or null for a
 * ticket opened before tickets recorded it. Whatever the ticket later sends its customer — the
 * agent's reply, the status notice, the closure request — goes out from this number, not from
 * whichever number the workspace happens to list first.
 */
export function ticketWhatsAppChannelId(sourceMeta: unknown): string | null {
  const id = asRecord(sourceMeta).channelConfigId
  return typeof id === "string" && id.length > 0 ? id : null
}
