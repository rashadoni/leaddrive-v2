import { CHANNEL_FORM_TYPES } from "@/lib/channels/channel-config-payload"

/**
 * What a PUT of the channel form may do to `ChannelConfig.settings` on every channel type except Facebook and
 * Instagram (those follow lib/channels/meta-server-settings, #343) and TikTok via Chatwoot (merged whole by the
 * route's own TikTok branch).
 *
 * The form rebuilds `settings` from its own fields on every save (lib/channels/channel-config-payload), and
 * `PUT /api/v1/channels/[id]` used to store that object as it came. So one Save erased every key the form does not
 * own — and on these rows several of them change what the channel does:
 *
 *   - the reply policy — on WhatsApp an unset `replyMode` means AI ON (lib/inbox/reply-mode, default-on), so a Save
 *     switched AI back on for a channel an admin had set to "agent", and dropped `draftMode`/`aiThreshold` with it,
 *     so the replies went out unreviewed. On Telegram and VK the same Save switched AI off;
 *   - the WhatsApp notification templates and the social-lead group;
 *   - the VK Callback `secret` and the SMS `inboundSecret`: both webhooks reject every inbound message without them
 *     (F-26), and the form has no field for either;
 *   - the Vonage API key: the API never returns it (F-33 strips credential-shaped keys), so its field is empty on
 *     every edit;
 *   - the whole configuration of a row the form does not configure at all. The catalog opens this same form for any
 *     row no card covers ("Other connected channels"). Social Monitoring, Slack, Teams and VoIP rows no longer get
 *     there — the route refuses them outright (lib/channels/dedicated-channel-types) — but a leftover row of another
 *     type can.
 *
 * Three rules follow. Keys the form owns (`chatId`, `confirmationCode`, `smsProvider`, `atlLogin`, `emailIntake`, …)
 * are in none of the lists below, so leaving one out of a save still clears it, exactly as before.
 */

/**
 * The reply policy, owned by `PATCH /api/v1/settings/channel-reply` for EVERY channel type: that endpoint lists and
 * writes all of a workspace's rows, and the webhooks of WhatsApp, Telegram, VK, TikTok/Chatwoot, Facebook and
 * Instagram read it. One list for all types, so a key the endpoint gains is protected everywhere at once. (The
 * Facebook/Instagram list in meta-server-settings carries the same seven; a test holds the two together.)
 */
export const REPLY_POLICY_SETTING_KEYS = [
  "replyMode",
  "afterHoursAi",
  "outOfOffice",
  "draftMode",
  "escalateKeywords",
  "aiThreshold",
  "aiRolloutPercent",
] as const

/**
 * Rule 1 — server-owned: the stored value always wins, whatever the request carries, so a PUT can neither erase
 * these keys nor write them. Each has its own endpoint, with its own validation.
 */
const SERVER_OWNED_SETTING_KEYS_BY_TYPE: Readonly<Record<string, readonly string[]>> = {
  whatsapp: [
    // api/v1/whatsapp/notification-settings
    "whatsappTicketStatusTemplates",
    "whatsappSurveyTemplate",
    "whatsappJourneyDefaultTemplate",
    // api/v1/social/whatsapp-group-settings writes the nested key; lib/social/whatsapp-group-delivery still falls
    // back to the four flat ones older rows carry.
    "socialLeadGroup",
    "socialLeadGroupId",
    "socialLeadGroupName",
    "whatsappSocialLeadGroupId",
    "whatsappSocialLeadGroupName",
  ],
}

/**
 * Rule 2 — write-only secrets: the API never returns them, so a request that leaves one out cannot mean "remove".
 * Kept unless the request carries a new non-empty value — the same "blank keeps" contract the route applies to the
 * credential columns. The channels API stays the way to set or rotate them.
 */
const WRITE_ONLY_SETTING_KEYS_BY_TYPE: Readonly<Record<string, readonly string[]>> = {
  // webhooks/vkontakte verifies every callback against it.
  vkontakte: ["secret"],
  // webhooks/sms-inbound verifies against `inboundSecret`; `apiKey` is the Vonage API key, whose form field is empty
  // on edit. The provider's own secret lives in the `apiKey` column, not here.
  sms: ["inboundSecret", "apiKey"],
}

/** Rule 3 — the form configures only these types; any other row's settings belong to that type's own screen. */
const CHANNEL_FORM_TYPE_SET: ReadonlySet<string> = new Set<string>(CHANNEL_FORM_TYPES)

function asSettingsRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

/** Keys protected by rule 1 on a row of `channelType`: the reply policy plus the type's own. */
export function serverOwnedSettingKeys(channelType: string): string[] {
  return [...REPLY_POLICY_SETTING_KEYS, ...(SERVER_OWNED_SETTING_KEYS_BY_TYPE[channelType] ?? [])]
}

/**
 * The `settings` to store when a PUT carries `settings` for a stored row of `channelType`, or `undefined` to leave
 * the stored settings exactly as they are.
 */
export function channelSettingsForUpdate(
  channelType: string,
  nextSettings: unknown,
  existingSettings: unknown,
): Record<string, unknown> | undefined {
  if (!CHANNEL_FORM_TYPE_SET.has(channelType)) return undefined

  const existing = asSettingsRecord(existingSettings)
  const merged: Record<string, unknown> = { ...asSettingsRecord(nextSettings) }

  for (const key of WRITE_ONLY_SETTING_KEYS_BY_TYPE[channelType] ?? []) {
    const sent = merged[key]
    if (typeof sent === "string" && sent.trim()) continue
    if (hasOwn(existing, key)) merged[key] = existing[key]
    else delete merged[key]
  }
  for (const key of serverOwnedSettingKeys(channelType)) {
    if (hasOwn(existing, key)) merged[key] = existing[key]
    else delete merged[key]
  }
  return merged
}
