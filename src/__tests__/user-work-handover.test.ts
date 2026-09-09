import { describe, it, expect, vi } from "vitest"
import { handOverOpenWork, isEmptyHandover } from "@/lib/user-work-handover"

function makeTx() {
  const calls: Record<string, unknown[]> = {}
  const model = (name: string) => ({
    updateMany: vi.fn(async (args: unknown) => {
      calls[name] = [...(calls[name] ?? []), args]
      return { count: 1 }
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
  return { tx, calls }
}

const ARGS = { orgId: "org-1", fromUserId: "leaving", toUserId: "admin-1" }

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

  it("не трогает закрытые сделки — и ловит CLOSED_WON, а не только WON", async () => {
    // Ловушка из реальных данных: на проде рядом живут WON, CLOSED_WON и LOST,
    // регистр смешанный. Список из двух значений пропустил бы CLOSED_WON и
    // передал бы сотню закрытых сделок вместе с открытыми.
    const { tx, calls } = makeTx()
    await handOverOpenWork(tx as never, ARGS)
    const where = (calls.deal[0] as { where: { NOT: { stage: { contains: string; mode: string } }[] } }).where
    const patterns = where.NOT.map((n) => n.stage.contains)
    expect(patterns).toContain("won")
    expect(patterns).toContain("lost")
    for (const n of where.NOT) expect(n.stage.mode).toBe("insensitive")
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
    // У проекта и подразделения нет «закрытого» состояния: ответственный нужен
    // всегда, поэтому фильтра по завершённости здесь быть не должно.
    expect((calls.project[0] as { where: Record<string, unknown> }).where).not.toHaveProperty("completedAt")
  })

  it("считает пустую передачу пустой", () => {
    expect(isEmptyHandover({
      deals: 0, leads: 0, tickets: 0, tasks: 0, projectTasks: 0, projects: 0, divisions: 0,
    })).toBe(true)
  })
})
