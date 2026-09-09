import { describe, it, expect, vi } from "vitest"
import { handOverOpenWork, isEmptyHandover } from "@/lib/user-work-handover"

/**
 * Тесты проверяют ПОВЕДЕНИЕ, а не форму запроса.
 *
 * Прежняя версия ассертила, что в `where` присутствуют строки "won"/"lost".
 * Она оставалась зелёной ровно в том сценарии, где терялись данные: у
 * организации со стадиями `Qazanıldı` / `Uduzdu` поиск этих подстрок не
 * совпадает ни с чем, фильтр не отсекает ничего, и все закрытые сделки
 * уезжают к админу. Тест, который нельзя провалить настоящей поломкой, —
 * не тест, поэтому здесь мини-движок `where` и настоящие строки.
 */
type Row = Record<string, unknown>

function matchesLeaf(cond: unknown, value: unknown): boolean {
  if (cond === null || typeof cond !== "object") return value === cond
  const c = cond as Record<string, unknown>
  if ("in" in c) return (c.in as unknown[]).includes(value)
  if ("equals" in c) {
    const a = c.equals
    if (c.mode === "insensitive" && typeof a === "string" && typeof value === "string") {
      return a.toLowerCase() === value.toLowerCase()
    }
    return a === value
  }
  throw new Error(`мини-движок не знает условия: ${JSON.stringify(cond)}`)
}

function matches(where: Row, row: Row): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === "NOT") {
      const clauses = Array.isArray(cond) ? cond : [cond]
      // Prisma: NOT-массив исключает строку, если она подходит под ЛЮБОЕ из условий.
      if (clauses.some((cl) => matches(cl as Row, row))) return false
      continue
    }
    if (!matchesLeaf(cond, row[key])) return false
  }
  return true
}

function makeTx(data: Record<string, Row[]> = {}) {
  const calls: Record<string, unknown[]> = {}
  const survivors: Record<string, Row[]> = {}
  const model = (name: string) => ({
    updateMany: vi.fn(async (args: { where: Row; data: Row }) => {
      calls[name] = [...(calls[name] ?? []), args]
      const rows = data[name]
      // Без набора данных модель не проверяется по существу — тест смотрит на
      // сам факт вызова, поэтому отвечаем как заглушка: одна затронутая строка.
      if (!rows) return { count: 1 }
      const hit = rows.filter((r) => matches(args.where, r))
      survivors[name] = rows.filter((r) => !matches(args.where, r))
      return { count: hit.length }
    }),
  })
  const tx = {
    deal: model("deal"),
    lead: model("lead"),
    ticket: model("ticket"),
    task: model("task"),
    projectTask: model("projectTask"),
    project: model("project"),
    division: model("division"),
  }
  return { tx, calls, survivors }
}

const ARGS = {
  orgId: "org-1",
  fromUserId: "leaving",
  toUserId: "admin-1",
  closedStages: ["WON", "CLOSED_WON", "LOST", "Qazanıldı", "Uduzdu"],
}

const base = { organizationId: "org-1", assignedTo: "leaving" }

describe("передача незакрытой работы", () => {
  it("переносит всё перечисленное на администратора, а не на кого попало", async () => {
    const { tx } = makeTx()
    const counts = await handOverOpenWork(tx as never, ARGS)
    for (const model of ["deal", "lead", "ticket", "task", "projectTask", "project", "division"] as const) {
      expect(tx[model].updateMany).toHaveBeenCalledOnce()
    }
    expect(counts.deals).toBe(1)
    expect(isEmptyHandover(counts)).toBe(false)
  })

  it("всегда ограничивает выборку организацией", async () => {
    // Пропущенный orgId увёл бы чужие сделки: RLS страхует, но полагаться на
    // единственный слой в операции, которая переписывает владельца, нельзя.
    const { tx, calls } = makeTx()
    await handOverOpenWork(tx as never, ARGS)
    for (const model of Object.keys(calls)) {
      const where = (calls[model][0] as { where: Record<string, unknown> }).where
      expect(where.organizationId, `${model} без организации`).toBe("org-1")
    }
  })

  it("оставляет закрытые сделки прежнему владельцу — на любом языке воронки", async () => {
    // Регрессия, ради которой этот файл переписан: воронка настраивается на
    // организацию, и «закрыто» может быть написано не по-английски.
    const { tx, survivors } = makeTx({
      deal: [
        { ...base, stage: "Qazanıldı" },
        { ...base, stage: "Uduzdu" },
        { ...base, stage: "CLOSED_WON" },
        { ...base, stage: "LOST" },
        { ...base, stage: "Danışıqlar" },
      ],
    })
    const counts = await handOverOpenWork(tx as never, ARGS)
    expect(counts.deals, "передать можно только открытую сделку").toBe(1)
    expect(survivors.deal.map((r) => r.stage)).toEqual(["Qazanıldı", "Uduzdu", "CLOSED_WON", "LOST"])
  })

  it("не пропускает CLOSED_WON мимо WON", async () => {
    // Исходная ловушка из реальных данных: рядом живут WON и CLOSED_WON.
    const { tx } = makeTx({ deal: [{ ...base, stage: "CLOSED_WON" }] })
    const counts = await handOverOpenWork(tx as never, ARGS)
    expect(counts.deals).toBe(0)
  })

  it("без словаря стадий не отсекает ничего, но и не проглатывает всё", async () => {
    // Пустой словарь = «закрытых стадий у организации нет». Тогда открытая
    // сделка обязана перейти: `in: []` не должен превратиться в «исключить всё».
    const { tx } = makeTx({ deal: [{ ...base, stage: "Новая" }] })
    const counts = await handOverOpenWork(tx as never, { ...ARGS, closedStages: [] })
    expect(counts.deals).toBe(1)
  })

  it("отличает открытое от закрытого по отметке времени, а не по строке статуса", async () => {
    // В схеме у Task прямо написано, что колонке status доверять нельзя:
    // там смесь legacy-значений и Kanban-статусов. completedAt однозначен.
    const { tx, calls } = makeTx()
    await handOverOpenWork(tx as never, ARGS)
    expect((calls.task[0] as { where: Record<string, unknown> }).where.completedAt).toBeNull()
    expect((calls.projectTask[0] as { where: Record<string, unknown> }).where.completedAt).toBeNull()
    expect((calls.ticket[0] as { where: Record<string, unknown> }).where.closedAt).toBeNull()
  })

  it("у проектов и подразделений переносит роль ответственного, а не исполнителя", async () => {
    const { tx, calls } = makeTx()
    await handOverOpenWork(tx as never, ARGS)
    expect((calls.project[0] as { data: Record<string, unknown> }).data).toEqual({ managerId: "admin-1" })
    expect((calls.division[0] as { data: Record<string, unknown> }).data).toEqual({ headUserId: "admin-1" })
  })

  it("не переписывает руководителя у завершённых проектов", async () => {
    // Иначе отчёт по руководителям за прошлый период меняется задним числом.
    const pbase = { organizationId: "org-1", managerId: "leaving" }
    const { tx, survivors } = makeTx({
      project: [
        { ...pbase, status: "completed" },
        { ...pbase, status: "Cancelled" },
        { ...pbase, status: "active" },
      ],
    })
    const counts = await handOverOpenWork(tx as never, ARGS)
    expect(counts.projects).toBe(1)
    expect(survivors.project.map((r) => r.status)).toEqual(["completed", "Cancelled"])
  })

  it("считает пустую передачу пустой", () => {
    expect(isEmptyHandover({
      deals: 0, leads: 0, tickets: 0, tasks: 0, projectTasks: 0, projects: 0, divisions: 0,
    })).toBe(true)
  })
})
