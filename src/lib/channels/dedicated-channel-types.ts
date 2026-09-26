/**
 * Channel types whose ChannelConfig rows belong to their own screen and endpoint, never to the channel form. The
 * generic channels API (`POST /api/v1/channels`, `PUT`/`DELETE /api/v1/channels/[id]`) refuses to create, change or
 * delete such a row, or to turn another row into one, and the channel catalog lists one only where a card shows it
 * (VoIP's). None of them is a conversation channel, so the reply-policy matrix (`/api/v1/settings/channel-reply`)
 * neither lists nor writes one — that route's header gives the reason per type.
 *
 * Found 2026-09-21: the catalog listed every row the API returns under "Other connected channels", with the form's Edit
 * and a Delete, and a workspace's Social Monitoring rows were among them. Social Monitoring finds each of its two rows by
 * type AND name: "Monitoring providers" (lib/social/monitoring-settings — the schedule, the search-index settings and the
 * encrypted Apify token) and "Monitoring scenarios" (lib/social/monitoring-scenarios — every scenario). Renaming the row
 * in the form, or picking another type in the form's type picker, left the readers on defaults and an empty scenario
 * list, and the next save from Social Monitoring created a fresh row beside the orphaned one. Delete removed the row
 * outright. The PUT already left their `settings` alone (lib/channels/server-owned-settings, rule 3); the name, the type
 * and the row itself were still open.
 */
const DEDICATED_CHANNEL_TYPE_ERRORS = {
  // api/v1/voip/config: the PBX credentials and the voice-agent switches. The first type refused here.
  voip: "VoIP configuration must be managed through the dedicated VoIP endpoint",
  // api/v1/social/monitoring-settings and api/v1/social/monitoring-scenarios.
  social_monitoring: "Social Monitoring configuration must be managed in Social Monitoring",
  // api/v1/integrations/slack and api/v1/integrations/teams: the notification hooks of Integrations.
  slack: "Slack configuration must be managed in Integrations",
  teams: "Microsoft Teams configuration must be managed in Integrations",
} as const satisfies Record<string, string>

type DedicatedChannelType = keyof typeof DEDICATED_CHANNEL_TYPE_ERRORS

export const DEDICATED_CHANNEL_TYPES = Object.keys(DEDICATED_CHANNEL_TYPE_ERRORS) as DedicatedChannelType[]

function dedicatedType(channelType: string | null | undefined): DedicatedChannelType | null {
  const normalized = channelType?.trim().toLowerCase() ?? ""
  return Object.prototype.hasOwnProperty.call(DEDICATED_CHANNEL_TYPE_ERRORS, normalized)
    ? (normalized as DedicatedChannelType)
    : null
}

export function isDedicatedChannelType(channelType: string | null | undefined): boolean {
  return dedicatedType(channelType) !== null
}

/**
 * Why the generic channels API refuses a request touching these types — the stored row's and the requested one — or
 * `null` when it does not.
 */
export function dedicatedChannelTypeError(...channelTypes: Array<string | null | undefined>): string | null {
  for (const channelType of channelTypes) {
    const type = dedicatedType(channelType)
    if (type) return DEDICATED_CHANNEL_TYPE_ERRORS[type]
  }
  return null
}
