/**
 * What the trash on a connected channel actually does — one rule for the DELETE route and the screen.
 *
 * The DELETE route (api/v1/channels/[id]) keeps its own literal list — security tests pin that block by its
 * text — and lib-channel-removal.test.ts fails if the two lists ever differ.
 *
 * Meta channels (WhatsApp, Facebook, Instagram) are DISCONNECTED: the row is switched off and its
 * credentials are cleared, so connecting the same number/page again through the catalog tile revives the
 * same row. Every other channel row is DELETED with its settings. Either way the conversations and
 * messages stay: their link to the channel is optional and set to null.
 *
 * The confirm dialog used to say "cannot be undone, will be permanently deleted" for all of them, which
 * was untrue for Meta channels (owner, 2026-10-26: Zeytun's WhatsApp).
 */
export const DISCONNECT_ON_REMOVE_CHANNEL_TYPES: ReadonlySet<string> = new Set(["facebook", "instagram", "whatsapp"])

export type ChannelRemovalKind = "disconnect" | "delete"

export function channelRemovalKind(channelType: string | null | undefined): ChannelRemovalKind {
  return channelType && DISCONNECT_ON_REMOVE_CHANNEL_TYPES.has(channelType) ? "disconnect" : "delete"
}
