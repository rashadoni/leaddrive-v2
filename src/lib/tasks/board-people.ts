/**
 * Who is offered as a board task's assignee, co-assignee, reporter and
 * @-mention: the board's own people, not the whole company.
 *
 * Zeytun, 2026-11-13 (an employee on Pharmastore): «orada mən digər
 * departamentlərdən adamların adlarını, familiyalarını görməli deyiləm… bir
 * sürü ad çıxır» — choosing her manager as the reporter she got all fifteen
 * people of the company, though the board has eight. Bordio offers a
 * project's members.
 *
 * The board's people are the ones the «Üzvlər» tab shows and board-access.ts
 * lets in: a view grant on the board or on its department (a department opens
 * its boards), and the heads of both — without anyone the board itself shuts
 * out. An admin sees every board but is not a member of each: listed only when
 * granted like anyone else.
 */

export interface BoardPeopleClient {
  division: {
    findFirst(args: {
      where: { id: string; organizationId: string }
      select: { id: true; parentDivisionId: true; headUserId: true }
    }): Promise<{ id: string; parentDivisionId: string | null; headUserId: string | null } | null>
  }
  boardPermission: {
    findMany(args: {
      where: { organizationId: string; divisionId: { in: string[] } }
      select: { userId: true; divisionId: true; canView: true }
    }): Promise<Array<{ userId: string; divisionId: string; canView: boolean }>>
  }
}

/**
 * The ids of a board's people, or null when the list should not be narrowed:
 * no such board, or a board nobody was put on yet — there the whole company is
 * offered, as before, rather than nobody.
 */
export async function boardPeopleIds(client: BoardPeopleClient, organizationId: string, divisionId: string): Promise<string[] | null> {
  const board = await client.division.findFirst({
    where: { id: divisionId, organizationId },
    select: { id: true, parentDivisionId: true, headUserId: true },
  })
  if (!board) return null
  const parent = board.parentDivisionId
    ? await client.division.findFirst({ where: { id: board.parentDivisionId, organizationId }, select: { id: true, parentDivisionId: true, headUserId: true } })
    : null
  const grants = await client.boardPermission.findMany({
    where: { organizationId, divisionId: { in: parent ? [board.id, parent.id] : [board.id] } },
    select: { userId: true, divisionId: true, canView: true },
  })
  // The board's own «no» beats the department's «yes» and a headship, as in board-access.ts.
  const shutOut = new Set(grants.filter((g) => g.divisionId === board.id && !g.canView).map((g) => g.userId))
  const people = new Set<string>()
  for (const grant of grants) if (grant.canView) people.add(grant.userId)
  for (const head of [board.headUserId, parent?.headUserId]) if (head) people.add(head)
  for (const id of shutOut) people.delete(id)
  return people.size > 0 ? [...people] : null
}

/** A people list with those already on the task kept in it: a name set before must not vanish from its field. */
export function withPeopleOnTask<T extends { id: string; name: string }>(people: readonly T[], onTask: ReadonlyArray<{ id: string; name: string } | null | undefined>): Array<T | { id: string; name: string }> {
  const known = new Set(people.map((p) => p.id))
  const extra: Array<{ id: string; name: string }> = []
  for (const person of onTask) {
    if (!person || known.has(person.id)) continue
    known.add(person.id)
    extra.push({ id: person.id, name: person.name })
  }
  return extra.length === 0 ? [...people] : [...people, ...extra].sort((a, b) => a.name.localeCompare(b.name))
}
