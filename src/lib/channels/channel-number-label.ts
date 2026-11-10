/**
 * Which number a channel is, in words a person can match against their own phone.
 *
 * `ChannelConfig.phoneNumber` does not hold the same thing on every row. For WhatsApp it is Meta's
 * `phone_number_id` — fifteen digits that read like a phone number and are not one — while the number
 * Meta displays is written by Embedded Signup into `settings.displayPhoneNumber`. For SMS and VoIP the
 * column is the real number. Printing the column bare therefore produced three indistinguishable
 * WhatsApp rows on 2026-11-10 (#1493), and the same question came straight back from the inbox: a
 * conversation showed «WhatsApp» and nothing about WHICH of the workspace's three numbers it reached.
 *
 * One reader, so the settings row and the conversation card cannot drift apart. The id prefix is a
 * localized word supplied by the caller, never built here.
 */

export type ChannelNumberSource = {
  channelType?: string | null
  phoneNumber?: string | null
  settings?: unknown
}

export type ChannelNumber = {
  value: string
  /** True when `value` is Meta's internal id, not a number anybody can dial. */
  isMetaId: boolean
}

export function channelNumber(channel: ChannelNumberSource): ChannelNumber | null {
  const settings = channel.settings && typeof channel.settings === "object"
    ? channel.settings as Record<string, unknown>
    : {}
  const shown = typeof settings.displayPhoneNumber === "string" ? settings.displayPhoneNumber.trim() : ""
  if (shown) return { value: shown, isMetaId: false }
  const raw = typeof channel.phoneNumber === "string" ? channel.phoneNumber.trim() : ""
  if (!raw) return null
  // Anywhere else that column is the number itself, and a number written in full stays as it is.
  if (channel.channelType !== "whatsapp" || raw.startsWith("+")) return { value: raw, isMetaId: false }
  return { value: raw, isMetaId: true }
}

/** The same number as one string, with `idPrefix` ("Meta ID" / «ID в Meta») in front of an id. */
export function channelNumberLabel(channel: ChannelNumberSource, idPrefix: string): string | undefined {
  const number = channelNumber(channel)
  if (!number) return undefined
  return number.isMetaId ? `${idPrefix} ${number.value}` : number.value
}
