import { prisma } from "@/lib/prisma"
import { voiceScopedWhere } from "./scoped-where"
import { SECTION_DESCRIPTORS, type SectionDescriptor } from "./section-registry"
import {
  buildVoiceTaskWhere,
  narrowVoiceTaskWhere,
  type VoiceTaskScopeContext,
} from "./task-scope"

/**
 * The generic reader: one function that answers for every described section.
 *
 * This replaces the pattern of writing a bespoke tool per entity, which is how
 * the assistant ended up unable to talk about leads, quotes and boards until
 * the owner asked about each one. Coverage now comes from the registry, so a
 * described section is answerable the moment it is described.
 *
 * Three rules hold everywhere in here, because each one is a way a spoken
 * number can be true and still mislead:
 *
 *  1. MONEY IS NEVER SUMMED ACROSS CURRENCIES. Ten thousand AZN plus ten
 *     thousand USD is twenty thousand of nothing. Totals cover the dominant
 *     currency only, and `mixedCurrencies` forces the agent to say so.
 *  2. A PERIOD IS ALWAYS NAMED. The response states which column and which
 *     window it used, so "how much did we sell in July" cannot be answered
 *     about today without the swap being audible.
 *  3. UNASSIGNED IS ITS OWN NUMBER, never a person-shaped row. "Nine leads
 *     belong to nobody" is actionable; a row called "Unassigned" read out in a
 *     list of names sounds like a colleague.
 */

export type Facet = "all" | "status" | "people" | "overdue" | "money"

export type Period = "today" | "yesterday" | "week" | "month" | "quarter" | "year"

/** Pre-resolved range for non-voice callers that know the user's IANA timezone. */
export type ExplicitPeriodRange = {
  from: Date
  toExclusive: Date
  timezone?: string
  label?: string
}

export type SectionReport = {
  section: string
  total: number
  open: number | null
  byStatus: { status: string; count: number }[] | null
  byPerson: { name: string; count: number }[] | null
  unassigned: number | null
  overdue: number | null
  money: { amount: number; currency: string; mixedCurrencies: boolean } | null
  /** Which column and window were applied — must be spoken when present. */
  periodApplied: {
    field: string
    from: string
    to: string
    endExclusive?: boolean
    timezone?: string
    label?: string
  } | null
  /** Facets the agent asked for but this section cannot provide. */
  unavailable: string[]
}

/** How many people to name. A spoken list is rarely heard past the third. */
const SPOKEN_PEOPLE_LIMIT = 6

type Delegate = {
  count: (a: unknown) => Promise<number>
  groupBy: (a: unknown) => Promise<unknown>
  findMany: (a: unknown) => Promise<unknown>
}

export async function readSection(
  orgId: string,
  section: string,
  now: Date,
  facet: Facet = "all",
  explicitRange?: ExplicitPeriodRange,
  taskContext?: VoiceTaskScopeContext,
): Promise<SectionReport | null> {
  const d: SectionDescriptor | undefined = SECTION_DESCRIPTORS[section]
  if (!d) return null

  const model = (prisma as unknown as Record<string, Delegate>)[d.model]
  if (!model) return null

  const want = (f: Facet) => facet === "all" || facet === f
  const unavailable: string[] = []

  // The period narrows every figure in the answer, not just one of them —
  // otherwise "this month" would silently mean different things per line.
  let periodApplied: SectionReport["periodApplied"] = null
  let base: Record<string, unknown> = { ...(d.baseWhere ?? {}) }
  if (explicitRange) {
    if (d.createdField) {
      const { from, toExclusive, timezone, label } = explicitRange
      if (from.getTime() >= toExclusive.getTime()) throw new Error("Invalid explicit reporting range")
      base = { ...(d.baseWhere ?? {}), [d.createdField]: { gte: from, lt: toExclusive } }
      periodApplied = {
        field: d.createdField,
        from: from.toISOString(),
        to: toExclusive.toISOString(),
        endExclusive: true,
        ...(timezone ? { timezone } : {}),
        ...(label ? { label } : {}),
      }
    } else {
      // Stated, never silently ignored: an unfiltered answer to a period
      // question is the single most misleading thing this tool could return.
      unavailable.push("period")
    }
  }

  const openWhere =
    d.statusField && d.closedStatuses?.length
      ? { ...base, [d.statusField]: { notIn: d.closedStatuses } }
      : base

  // `boards` is backed by Task, whose per-board scope is stricter than the
  // role/module gate even for managers. Every aggregate below must start from
  // the same list/export WHERE; a missing context or resolver failure is an
  // error so the API can fail closed rather than silently widen to the org.
  if (d.model === "task" && !taskContext) {
    throw new Error("Voice task scope context required")
  }
  const taskWhere = d.model === "task"
    ? await buildVoiceTaskWhere(orgId, taskContext!)
    : null
  const scopedWhere = (where: Record<string, unknown>) =>
    taskWhere
      ? narrowVoiceTaskWhere(taskWhere, where)
      : voiceScopedWhere(orgId, where)

  const total = await model.count({ where: scopedWhere(base) })
  const open =
    d.statusField && d.closedStatuses?.length
      ? await model.count({ where: scopedWhere(openWhere) })
      : null

  let byStatus: SectionReport["byStatus"] = null
  if (want("status")) {
    if (d.statusField) {
      const rows = (await model.groupBy({
        by: [d.statusField],
        where: scopedWhere(base),
        _count: { _all: true },
      })) as Record<string, unknown>[]
      byStatus = rows
        .map((r) => ({ status: String(r[d.statusField!]), count: (r._count as { _all: number })._all }))
        .sort((a, b) => b.count - a.count)
    } else if (facet === "status") {
      unavailable.push("status")
    }
  }

  let byPerson: SectionReport["byPerson"] = null
  let unassigned: number | null = null
  if (want("people")) {
    if (d.assigneeField) {
      const rows = (await model.groupBy({
        by: [d.assigneeField],
        where: scopedWhere(openWhere),
        _count: { _all: true },
      })) as Record<string, unknown>[]
      const ids = rows
        .map((r) => r[d.assigneeField!])
        .filter((v): v is string => typeof v === "string" && v.length > 0)
      const users = ids.length
        ? ((await prisma.user.findMany({
            where: voiceScopedWhere(orgId, { id: { in: ids } }),
            select: { id: true, name: true },
          })) as { id: string; name: string }[])
        : []
      const nameById = new Map(users.map((u) => [u.id, u.name]))
      const named: { name: string; count: number }[] = []
      let none = 0
      for (const r of rows) {
        const id = r[d.assigneeField!]
        const c = (r._count as { _all: number })._all
        const name = typeof id === "string" ? nameById.get(id) : undefined
        // A deleted user still referenced by the row counts as unassigned
        // rather than appearing as a blank name.
        if (name) named.push({ name, count: c })
        else none += c
      }
      byPerson = named.sort((a, b) => b.count - a.count).slice(0, SPOKEN_PEOPLE_LIMIT)
      unassigned = none
    } else if (facet === "people") {
      unavailable.push("people")
    }
  }

  let overdue: number | null = null
  if (want("overdue")) {
    if (d.dueField) {
      overdue = await model.count({
        where: scopedWhere({ ...openWhere, [d.dueField]: { lt: now } }),
      })
    } else if (facet === "overdue") {
      unavailable.push("overdue")
    }
  }

  let money: SectionReport["money"] = null
  if (want("money")) {
    if (d.amountField && d.currencyField) {
      const rows = (await model.groupBy({
        by: [d.currencyField],
        where: scopedWhere(openWhere),
        _count: { _all: true },
        _sum: { [d.amountField]: true },
      })) as Record<string, unknown>[]
      // Dominant currency = the one carrying the most ROWS, not the most money:
      // a single large foreign deal must not redenominate the whole answer.
      const sorted = rows.sort(
        (a, b) => (b._count as { _all: number })._all - (a._count as { _all: number })._all,
      )
      const top = sorted[0]
      money = top
        ? {
            amount: Math.round(Number((top._sum as Record<string, unknown>)[d.amountField] ?? 0)),
            currency: String(top[d.currencyField]),
            mixedCurrencies: sorted.length > 1,
          }
        : { amount: 0, currency: "AZN", mixedCurrencies: false }
    } else if (facet === "money") {
      unavailable.push("money")
    }
  }

  return { section, total, open, byStatus, byPerson, unassigned, overdue, money, periodApplied, unavailable }
}
