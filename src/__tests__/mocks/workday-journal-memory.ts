import type { MtmPrismaMock } from "./mtm-prisma"

/**
 * An in-memory workday journal behind the shared MTM prisma mock, so the real
 * state machine (`applyMtmWorkdayEvent`) and the real reopen/undo services can
 * run one after another over the same rows. It implements only the query
 * shapes those writers use; an unexpected filter throws instead of matching.
 */
export type MemoryRow = Record<string, unknown>

export type InMemoryWorkdayJournal = {
  workdays: Map<string, MemoryRow>
  events: MemoryRow[]
  reopens: MemoryRow[]
  /** The server clock stamped on created/updated workday rows. */
  setClock(at: Date): void
  workday(id: string): MemoryRow
  /** One workday's events in journal order, as the replay reads them. */
  journal(workdayId: string): MemoryRow[]
}

function matches(row: MemoryRow, where: MemoryRow = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key]
    if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime()
    if (condition && typeof condition === "object") {
      const filter = condition as { in?: unknown[]; not?: unknown }
      if (Array.isArray(filter.in)) return filter.in.includes(value)
      if ("not" in filter) return value !== filter.not
      throw new Error(`unsupported filter on ${key}`)
    }
    return value === condition
  })
}

function time(value: unknown): number {
  return value instanceof Date ? value.getTime() : Number.NEGATIVE_INFINITY
}

/** WORKFORCE_WORKDAY_JOURNAL_ORDER: instant, then application time (nulls first), then id. */
function journalOrder(left: MemoryRow, right: MemoryRow): number {
  const byInstant = time(left.occurredAt) - time(right.occurredAt)
  if (byInstant !== 0) return byInstant
  const leftApplied = time(left.appliedAt)
  const rightApplied = time(right.appliedAt)
  if (leftApplied !== rightApplied) return leftApplied < rightApplied ? -1 : 1
  return String(left.id).localeCompare(String(right.id))
}

function firstArgument(args: unknown[]): MemoryRow {
  const [query] = args
  return query && typeof query === "object" ? query as MemoryRow : {}
}

function whereOf(query: MemoryRow): MemoryRow {
  return query.where && typeof query.where === "object" ? query.where as MemoryRow : {}
}

export function installInMemoryWorkdayJournal(
  db: MtmPrismaMock,
  options: { agentUserId: string },
): InMemoryWorkdayJournal {
  const workdays = new Map<string, MemoryRow>()
  const events: MemoryRow[] = []
  const reopens: MemoryRow[] = []
  let clock = new Date(0)

  const workday = (id: string): MemoryRow => {
    const row = workdays.get(id)
    if (!row) throw new Error(`workday ${id} missing`)
    return row
  }

  db.mtmAgentWorkday.findFirst.mockReset().mockImplementation(async (...args: unknown[]) => {
    const where = whereOf(firstArgument(args))
    const row = [...workdays.values()].find((candidate) => matches(candidate, where))
    return row ? { ...row, agent: { userId: options.agentUserId } } : null
  })
  db.mtmAgentWorkday.create.mockReset().mockImplementation(async (...args: unknown[]) => {
    const data = firstArgument(args).data as MemoryRow
    const row: MemoryRow = {
      totalPausedSeconds: 0,
      pausedAt: null,
      completedAt: null,
      endLatitude: null,
      endLongitude: null,
      ...data,
      createdAt: clock,
      updatedAt: clock,
    }
    workdays.set(String(data.id), row)
    return { ...row }
  })
  db.mtmAgentWorkday.update.mockReset().mockImplementation(async (...args: unknown[]) => {
    const query = firstArgument(args)
    const id = String(whereOf(query).id)
    const row: MemoryRow = { ...workday(id), ...(query.data as MemoryRow), updatedAt: clock }
    workdays.set(id, row)
    return { ...row }
  })
  db.mtmAgentWorkdayEvent.findFirst.mockReset().mockImplementation(async (...args: unknown[]) => {
    const query = firstArgument(args)
    const orderBy = query.orderBy as MemoryRow | undefined
    const found = events.filter((event) => matches(event, whereOf(query))).sort(journalOrder)
    if (orderBy && !Array.isArray(orderBy) && orderBy.occurredAt === "desc") found.reverse()
    return found[0] ?? null
  })
  db.mtmAgentWorkdayEvent.findMany.mockReset().mockImplementation(async (...args: unknown[]) => (
    events.filter((event) => matches(event, whereOf(firstArgument(args)))).sort(journalOrder)
  ))
  db.mtmAgentWorkdayEvent.create.mockReset().mockImplementation(async (...args: unknown[]) => {
    const event: MemoryRow = {
      id: `event-${String(events.length + 1).padStart(4, "0")}`,
      ...(firstArgument(args).data as MemoryRow),
    }
    events.push(event)
    return { ...event }
  })
  db.workforceWorkdayReopen.findFirst.mockReset().mockImplementation(async (...args: unknown[]) => (
    reopens.find((row) => matches(row, whereOf(firstArgument(args)))) ?? null
  ))
  db.workforceWorkdayReopen.create.mockReset().mockImplementation(async (...args: unknown[]) => {
    const row: MemoryRow = {
      id: `reopen-${String(reopens.length + 1).padStart(4, "0")}`,
      ...(firstArgument(args).data as MemoryRow),
    }
    reopens.push(row)
    return { id: row.id }
  })

  return {
    workdays,
    events,
    reopens,
    setClock(at: Date) {
      clock = at
    },
    workday,
    journal(workdayId: string) {
      return events.filter((event) => event.workdayId === workdayId).sort(journalOrder)
    },
  }
}
