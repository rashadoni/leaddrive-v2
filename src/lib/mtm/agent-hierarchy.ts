/**
 * Команды на странице «Агенты» (/mtm/agents).
 *
 * Прод 2026-09-15, LeadDrive Inc.: владелец искал менеджера и не нашёл. Карточки
 * группировались по `manager.name`, у самого менеджера руководителя нет — и его
 * карточка тонула в корзине «без менеджера» в самом низу, а заголовок его
 * команды был просто подписью без человека.
 *
 * Правила (одна карточка — ровно одно место на странице):
 * 1. Команду возглавляет любой, у кого есть прямые подчинённые во ВСЁМ списке
 *    (связь `managerId` — источник истины, роль лишь подпись). Команда
 *    начинается с карточки руководителя, за ней — его прямые подчинённые.
 * 2. Руководитель, который сам подчиняется другому руководителю, НЕ получает
 *    отдельную команду верхнего уровня: он показан вложенной подкомандой внутри
 *    команды своего начальника. Так его карточка не дублируется.
 * 3. Если руководителя нет в загруженном списке (фильтр, поиск или скоуп
 *    веб-менеджера, в который его начальник не входит), видимые подчинённые
 *    остаются под его именем (группа без карточки руководителя), а не падают
 *    в «без менеджера» — менеджер у них есть.
 * 4. Все остальные, у кого нет ни руководителя, ни подчинённых (включая
 *    менеджеров без команды), — в корзине «Менеджер не назначен» в конце.
 * 5. Цикл в данных (A — начальник B, B — начальник A) не зацикливает обход:
 *    каждая карточка выводится один раз.
 */

export type MtmHierarchyAgent = {
  id: string
  name?: string | null
  role?: string | null
  managerId?: string | null
  manager?: { id: string; name?: string | null } | null
}

export type MtmAgentTeam<T extends MtmHierarchyAgent> = {
  /** managerId of the team; stable React key. */
  key: string
  /** Name shown in the header — the leader's own name. */
  label: string
  /** The leader's card, or null when the filter hid it (rule 3). */
  leader: T | null
  /** Direct reports that lead nobody. */
  members: T[]
  /** Direct reports that lead their own team (rule 2). */
  subteams: MtmAgentTeam<T>[]
  /** Visible cards in this team, leader and nested teams included. */
  size: number
}

export type MtmAgentHierarchy<T extends MtmHierarchyAgent> = {
  teams: MtmAgentTeam<T>[]
  unassigned: T[]
}

export const MTM_LEADER_ROLES = ["MANAGER", "SUPERVISOR"] as const

export function isMtmLeaderRole(role: string | null | undefined): boolean {
  return role === "MANAGER" || role === "SUPERVISOR"
}

/**
 * @param visible cards that passed filters/search, in display order
 * @param all every card on the page — used to tell who leads a team even when
 *            that team's members are filtered out
 */
export function buildMtmAgentHierarchy<T extends MtmHierarchyAgent>(visible: T[], all: T[] = visible): MtmAgentHierarchy<T> {
  const visibleIds = new Set(visible.map((agent) => agent.id))
  const leadsSomeone = new Set<string>()
  for (const agent of all) if (agent.managerId && agent.managerId !== agent.id) leadsSomeone.add(agent.managerId)
  for (const agent of visible) if (agent.managerId && agent.managerId !== agent.id) leadsSomeone.add(agent.managerId)

  const reportsOf = new Map<string, T[]>()
  for (const agent of visible) {
    if (!agent.managerId || agent.managerId === agent.id || !visibleIds.has(agent.managerId)) continue
    const list = reportsOf.get(agent.managerId) ?? []
    list.push(agent)
    reportsOf.set(agent.managerId, list)
  }

  const placed = new Set<string>()
  const build = (leader: T): MtmAgentTeam<T> => {
    placed.add(leader.id)
    const team: MtmAgentTeam<T> = { key: leader.id, label: leader.name || "", leader, members: [], subteams: [], size: 1 }
    for (const report of reportsOf.get(leader.id) ?? []) {
      if (placed.has(report.id)) continue
      if (leadsSomeone.has(report.id)) {
        const sub = build(report)
        team.subteams.push(sub)
        team.size += sub.size
      } else {
        placed.add(report.id)
        team.members.push(report)
        team.size += 1
      }
    }
    return team
  }

  const teams: MtmAgentTeam<T>[] = []
  const orphanTeams = new Map<string, MtmAgentTeam<T>>()
  const unassigned: T[] = []
  const hasVisibleManager = (agent: T) => !!agent.managerId && agent.managerId !== agent.id && visibleIds.has(agent.managerId)

  // Roots first: nobody visible above them.
  for (const agent of visible) {
    if (placed.has(agent.id) || hasVisibleManager(agent)) continue
    if (leadsSomeone.has(agent.id)) {
      const team = build(agent)
      // Rule 3 for a leader: their own boss is hidden — still a top-level team.
      teams.push(team)
    } else if (agent.managerId && agent.managerId !== agent.id) {
      placed.add(agent.id)
      const key = agent.managerId
      let team = orphanTeams.get(key)
      if (!team) {
        team = { key, label: agent.manager?.name || "", leader: null, members: [], subteams: [], size: 0 }
        orphanTeams.set(key, team)
        teams.push(team)
      }
      team.members.push(agent)
      team.size += 1
    } else {
      placed.add(agent.id)
      unassigned.push(agent)
    }
  }
  // Rule 5: whatever a cycle kept unreachable gets a team of its own.
  for (const agent of visible) {
    if (placed.has(agent.id)) continue
    teams.push(build(agent))
  }

  // Biggest team first so the page opens on a full grid; ties keep input order.
  const order = new Map(teams.map((team, index) => [team, index]))
  teams.sort((a, b) => b.size - a.size || (order.get(a)! - order.get(b)!))
  return { teams, unassigned }
}

/** Every card of a team in display order: leader, members, then nested teams. */
export function flattenMtmAgentTeam<T extends MtmHierarchyAgent>(team: MtmAgentTeam<T>, depth = 0): Array<{ agent: T; depth: number; isLeader: boolean; team: MtmAgentTeam<T> }> {
  const rows: Array<{ agent: T; depth: number; isLeader: boolean; team: MtmAgentTeam<T> }> = []
  if (team.leader) rows.push({ agent: team.leader, depth, isLeader: true, team })
  for (const member of team.members) rows.push({ agent: member, depth: depth + 1, isLeader: false, team })
  for (const sub of team.subteams) rows.push(...flattenMtmAgentTeam(sub, depth + 1))
  return rows
}

export type MtmSearchableAgent = {
  name?: string | null
  email?: string | null
  phone?: string | null
  externalCode?: string | null
  userEmail?: string | null
}

/**
 * Search over what a manager actually types: the name, the card email, the
 * phone (with or without spaces and dashes), the agent code and the email of
 * the linked web login — the owner searched for «rashad@guven.az», which lives
 * only on the login, not on the card.
 */
export function mtmAgentMatchesSearch(agent: MtmSearchableAgent, query: string): boolean {
  const q = query.trim().toLocaleLowerCase()
  if (!q) return true
  const texts = [agent.name, agent.email, agent.phone, agent.externalCode, agent.userEmail]
  if (texts.some((value) => typeof value === "string" && value.toLocaleLowerCase().includes(q))) return true
  if (/^[\d\s()+-]+$/.test(q)) {
    const qDigits = mtmLocalPhoneDigits(q)
    if (qDigits.length >= 3 && mtmLocalPhoneDigits(agent.phone).includes(qDigits)) return true
  }
  return false
}

/**
 * Azerbaijani numbers are typed three ways: «050 123 45 67», «+994 50 1234567»
 * and «994501234567». Digits only, without the country code or the trunk 0,
 * so all three compare equal (review of #214).
 */
export function mtmLocalPhoneDigits(value: string | null | undefined): string {
  const digits = (value || "").replace(/\D/g, "")
  if (digits.startsWith("994")) return digits.slice(3)
  if (digits.startsWith("0")) return digits.slice(1)
  return digits
}
