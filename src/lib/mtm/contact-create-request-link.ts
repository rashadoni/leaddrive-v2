/**
 * The address of agents' requests for a new client: /mtm/contacts with the
 * request queue above the list already unfolded, its cards and their
 * «Təsdiq et» / «Rədd et» on the first screen.
 *
 * Owner 2026-10-20, on the Panel: «Sorğuya bax» on «Yeni müştəri sorğusu»
 * opened the whole list of existing clients. The queue was there, folded to
 * one line above the list, and nothing on the screen was the request the
 * button had promised.
 */
export const MTM_CONTACT_REQUESTS_PARAM = "requests"
const OPEN = "open"

export const MTM_CONTACT_REQUESTS_HREF = `/mtm/contacts?${MTM_CONTACT_REQUESTS_PARAM}=${OPEN}`

/** Whether the address asks for the queue unfolded. */
export function contactRequestsAsked(value: string | string[] | null | undefined): boolean {
  return (Array.isArray(value) ? value[0] : value) === OPEN
}

/**
 * Whether the address carries the list's own state. The queue's switch is not
 * the list's: arriving with it alone, the manager's default saved view still
 * applies to the list under the queue.
 */
export function contactListStateInUrl(params: Pick<URLSearchParams, "keys">): boolean {
  for (const key of params.keys()) if (key !== MTM_CONTACT_REQUESTS_PARAM) return true
  return false
}
