/**
 * Which actions of the inbox thread header stand in the header itself and which
 * live in its «Daha çox» menu, by the width of the conversation column.
 *
 * At 1280 px with the full CRM menu the conversation column is ~410 px, and the
 * header's actions took ~485 px in one row that could not shrink: the inbox root
 * clips its overflow, so the right ~140 px — the «…» and the snooze/folder
 * icons — were simply gone. At 1024 the column is ~155 px.
 *
 * Since then the list steps aside for an open conversation where the inbox is
 * too narrow for three columns (inbox-columns.ts), and «Söhbətlər» at the start
 * of this row brings it back. The page measures the room the name and the
 * actions get beside it: 370 px at 1024, 626 px at 1280, 428–572 px with the
 * list beside the conversation.
 *
 * The owner does not read icons, so nothing that had words loses them: what
 * does not fit moves into «Daha çox», where every action is written out. The
 * rare actions (snooze, folder, trash) stand there at every width, with words
 * instead of the clock, folder and bin icons.
 *
 * The call control is not in this table on purpose: it stays in the header at
 * every width. It holds a live call (the WhatsApp one keeps its WebRTC session
 * in the component), and a menu that closes would unmount it mid-call.
 *
 * The widths below are measured in Chromium with the app's own CSS and the
 * longest labels of the three languages; the header also wraps its actions to
 * a second line rather than clip them if a label ever comes out wider.
 */

export type ThreadHeaderTier = "wide" | "medium" | "narrow"

export type ThreadHeaderAction = "assign" | "participants" | "lead" | "close" | "snooze" | "folder" | "trash"

/**
 * From this column width «İştirakçılar» and «Lidə çevir» stand in the header
 * beside «Təyin et». The widest row is Russian («Преобразовать в лид»): 551 px
 * with a long assignee and three participants, 569 px when the thread is also
 * snoozed; with the header's padding that leaves the name ~150 px here.
 */
export const THREAD_HEADER_WIDE_MIN_PX = 760

/**
 * From this column width «Təyin et» and the close tick stand in the header;
 * below it only the call and «Daha çox» do. The widest row is Azerbaijani:
 * 299 px with a long assignee, 317 px snoozed, plus 32 px padding, an 8 px gap
 * and the 44 px avatar = 401 px, and a few pixels for another platform's font.
 * The 1280 px window with the full CRM menu gave the column 412 px; the
 * three columns now stand only where it gets at least 428 px.
 */
export const THREAD_HEADER_MEDIUM_MIN_PX = 408

/**
 * The tier for a measured header width. Zero means «not measured» (before the
 * first layout, or no layout at all): the full header, as it was before tiers.
 */
export function threadHeaderTier(width: number): ThreadHeaderTier {
  if (!(width > 0) || width >= THREAD_HEADER_WIDE_MIN_PX) return "wide"
  if (width >= THREAD_HEADER_MEDIUM_MIN_PX) return "medium"
  return "narrow"
}

const INLINE: Record<ThreadHeaderTier, ReadonlySet<ThreadHeaderAction>> = {
  wide: new Set(["assign", "participants", "lead", "close"]),
  medium: new Set(["assign", "close"]),
  narrow: new Set(),
}

/** True when the action stands in the header; false when it is an item of «Daha çox». */
export function threadHeaderActionInline(tier: ThreadHeaderTier, action: ThreadHeaderAction): boolean {
  return INLINE[tier].has(action)
}
