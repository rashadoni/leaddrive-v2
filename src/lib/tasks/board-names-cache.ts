/**
 * Board names already read in this tab, by board id.
 *
 * Switching boards remounts the board page, and its title waited for its own
 * GET /api/v1/divisions — 4–5 s of a bare «Board» on a slow moment (found
 * 2026-11-09 while recording the Boards video guide), although the sidebar's
 * board tree had read the same list long before. Whoever reads the list
 * records the names here; the board page names itself from it at once and
 * its own read replaces it.
 *
 * Only names, looked up by id: ids are unique across organizations, so a name
 * left over from another organization can never title this one's board.
 */
const names = new Map<string, string>()

export function rememberBoardNames(divisions: readonly { id?: unknown; name?: unknown }[]): void {
  for (const d of divisions) {
    if (typeof d?.id === "string" && typeof d?.name === "string" && d.name) names.set(d.id, d.name)
  }
}

export function knownBoardName(id: string): string | null {
  return names.get(id) ?? null
}

/** Tests only. */
export function forgetBoardNames(): void {
  names.clear()
}
