/**
 * Brings the map's frame back onto the screen when the place it is about to
 * show would be out of sight.
 *
 * «На карте» is pressed on a row of a list that stands outside the map. On a
 * phone that list is under the map, a screen below it: the map would move
 * where nobody is looking, and the button would seem to do nothing. So the map
 * comes back into view first.
 *
 * Two cases, and no other:
 * - the frame's top edge is above the top of what scrolls. The map centres the
 *   place asked for in the whole frame, so with the upper part of the frame
 *   scrolled away the place can lie above the screen's edge although most of
 *   the map is in view. The page scrolls inside <main>, under the header:
 *   «above» is counted from <main>'s own top edge, not from the window's;
 * - the frame is cut at the bottom and less than half of it can be seen.
 *
 * Beside the list on a wide screen neither happens: the frame stays put under
 * the top edge while the list scrolls, and at the top of the page only a strip
 * of it is below the screen's edge — bringing in that strip would make the
 * page jump under the pointer. A frame already in its place is not moved again
 * by a second press.
 */
export function bringMapFrameIntoView(frame: HTMLElement | null): void {
  if (!frame || typeof window === "undefined") return
  const place = frame.getBoundingClientRect()
  const portTop = frame.closest("main")?.getBoundingClientRect().top ?? 0
  const seen = Math.min(place.bottom, window.innerHeight) - Math.max(place.top, portTop)
  if (place.top < portTop || seen < place.height / 2) frame.scrollIntoView?.({ block: "nearest" })
}
