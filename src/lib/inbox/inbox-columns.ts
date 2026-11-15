/**
 * Whether the conversation list stands beside an open conversation, by the
 * width of the inbox itself (owner, 2026-11-15, by a mock-up of three
 * variants: «Делай А»).
 *
 * The inbox is three columns: the folder rail (224 px), the list (320 px) and
 * the conversation, with a 1 px seam between columns and a 1 px border on each
 * side. With the full CRM menu (256 px) and the page's 32 px padding, a 1024 px
 * window gives the inbox 704 px and used to leave the conversation 156 px — two
 * or three words a line and a clipped reply box; 1280 left it 412 px with the
 * customer's name cut short.
 *
 * Below the width at which the conversation keeps INBOX_THREAD_BESIDE_LIST_MIN_PX
 * beside the list, an open conversation takes the list's place, as it always
 * did on phones, and «Söhbətlər» in its header brings the list back. The rail
 * stays: it is how people move between views and channels. Folding the rail
 * into a strip of icons was the other variant; it still left 324 px at 1024
 * and the owner does not read icons.
 *
 * Measured on the inbox, not on the window, so a collapsed CRM menu (64 px)
 * counts too: there three columns stand from a ~1104 px window, with the full
 * menu from ~1296 px.
 */

/** The narrowest conversation that stands beside the list. */
export const INBOX_THREAD_BESIDE_LIST_MIN_PX = 428

const BORDERS_PX = 2
const RAIL_PX = 224
const LIST_PX = 320
const SEAMS_PX = 2

/** From this inbox width the list stands beside an open conversation (976 px). */
export const INBOX_LIST_BESIDE_THREAD_MIN_PX =
  BORDERS_PX + RAIL_PX + SEAMS_PX + LIST_PX + INBOX_THREAD_BESIDE_LIST_MIN_PX

/**
 * True when the list stands beside an open conversation at this inbox width.
 * Zero means «not measured» (before the first layout, or no layout at all):
 * the three columns, as the inbox was before it measured itself.
 */
export function inboxListBesideThread(inboxWidth: number): boolean {
  return !(inboxWidth > 0) || inboxWidth >= INBOX_LIST_BESIDE_THREAD_MIN_PX
}
