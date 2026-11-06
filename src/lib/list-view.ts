/**
 * The list screens' contract with their API — contacts, companies, deals.
 *
 * Until 2026-11 the three screens loaded `?limit=500` (deals `?limit=200`) and
 * searched, filtered and sorted in the browser. A record past the first 500
 * could not be found by search at all, and every visit pulled hundreds of
 * full rows. With `view=list` the route does the searching, filtering, sorting
 * and paging itself, selects only the columns the list shows, and answers the
 * counters the screen prints above the list.
 *
 * Callers without `view=list` (dropdown pickers across the app) keep the old
 * shape: full rows and a name-only search. Their `limit` is bounded too, but
 * at what the largest of them asks for, so no picker loses options here.
 */

/** Largest page a list screen may ask for. */
export const LIST_VIEW_MAX_LIMIT = 200

/** "Select all N found" asks for the ids of every match — at most this many. */
export const LIST_IDS_MAX = 1000

/** A search term longer than this is cut: nobody types it, and ILIKE pays for every character. */
export const LIST_SEARCH_MAX_CHARS = 100

export function isListView(searchParams: URLSearchParams): boolean {
  return searchParams.get("view") === "list"
}

/**
 * page ≥ 1 and 1 ≤ limit ≤ max. Garbage falls back to the defaults instead of
 * reaching Prisma as NaN (which was a 500).
 *
 * `offset`, when given, wins over `page`: "Show more" asks for the rows after
 * the ones on screen, which stays right after an edit or a delete has shifted
 * the page boundaries.
 */
export function listPaging(
  searchParams: URLSearchParams,
  { defaultLimit, maxLimit }: { defaultLimit: number; maxLimit: number },
): { page: number; limit: number; skip: number } {
  const rawPage = Number.parseInt(searchParams.get("page") || "", 10)
  const rawLimit = Number.parseInt(searchParams.get("limit") || "", 10)
  const rawOffset = Number.parseInt(searchParams.get("offset") || "", 10)
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1
  const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(rawLimit, maxLimit) : Math.min(defaultLimit, maxLimit)
  const skip = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : (page - 1) * limit
  return { page, limit, skip }
}

export function listSearchTerm(searchParams: URLSearchParams): string {
  return (searchParams.get("search") || "").trim().slice(0, LIST_SEARCH_MAX_CHARS)
}

/**
 * `{ contains, mode: "insensitive" }` — Postgres ILIKE '%term%'.
 *
 * Prisma passes the term into the LIKE pattern as is, so a `%` or `_` typed in
 * the search box was a wildcard: «50%» found «Discount 500» too (seen on a real
 * Postgres in crm-list-view-postgres.test.ts). Backslash is Postgres' default
 * LIKE escape, so the three are escaped with it.
 */
export function containsInsensitive(term: string) {
  return { contains: term.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" as const }
}
