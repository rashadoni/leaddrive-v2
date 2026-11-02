/**
 * What the trash on a connected channel actually does — one rule for the DELETE route and the screen.
 *
 * The DELETE route (api/v1/channels/[id]) keeps its own literal list — security tests pin that block by its
 * text — and lib-channel-removal.test.ts fails if the two lists ever differ.
 *
 * Meta channels (WhatsApp, Facebook, Instagram) that are switched on are DISCONNECTED: the row is switched off
 * and its credentials are cleared, so connecting the same number/page again through the catalog tile revives the
 * same row. A Meta row already switched off, and every other channel row, is DELETED with its settings. Either way the conversations and
 * messages stay: their link to the channel is optional and set to null.
 *
 * The confirm dialog used to say "cannot be undone, will be permanently deleted" for all of them, which
 * was untrue for Meta channels (owner, 2026-10-26: Zeytun's WhatsApp).
 */
export const DISCONNECT_ON_REMOVE_CHANNEL_TYPES: ReadonlySet<string> = new Set(["facebook", "instagram", "whatsapp"])

export type ChannelRemovalKind = "disconnect" | "delete"

/**
 * A Meta channel that is switched on is disconnected; one already switched off is deleted, so it can leave the
 * connected list (owner, 2026-10-27). `isActive` defaults to on: without it the screen promises the softer action.
 */
export function channelRemovalKind(channelType: string | null | undefined, isActive = true): ChannelRemovalKind {
  return channelType && DISCONNECT_ON_REMOVE_CHANNEL_TYPES.has(channelType) && isActive ? "disconnect" : "delete"
}
