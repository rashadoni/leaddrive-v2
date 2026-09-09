import type { Prisma } from "@prisma/client"

/**
 * Передача незакрытой работы при обезличивании пользователя.
 *
 * Зачем. Обезличивание оставляет строку пользователя живой, поэтому ссылки на
 * него никуда не деваются — и открытые сделки, лиды, тикеты и задачи остаются
 * закреплёнными за тем, кого уже нет. Формально данные целы, практически
 * работа исчезает из чьих-либо списков.
 *
 * Замер на проде 2026-09-09, ДО каких-либо изменений: 16 тикетов, 5 лидов и
 * 1 сделка висели на несуществующих идентификаторах, ещё 14 сделок и 11 лидов
 * — на отключённых сотрудниках, и 86 задач вовсе без исполнителя. То есть
 * потеря ответственного — не гипотеза, она уже происходила.
 *
 * Кому передаём. В модели НЕТ линии подчинения: у `User` нет ни `managerId`,
 * ни `divisionId`; иерархия есть только у полевых агентов (`MtmAgent.managerId`)
 * и у проектов (`Project.managerId`). Поэтому «руководителя» вычислить не из
 * чего, и придумывать его — гадание. Работа переходит к АДМИНИСТРАТОРУ,
 * который выполняет удаление: он живой, он принимает решение, он сразу видит
 * пришедшее у себя и может раздать дальше.
 *
 * Что НЕ передаём:
 *   • закрытое — у него нет будущего, а перенос исказил бы отчёты по
 *     владельцам за прошлые периоды;
 *   • авторство — «кто создал», «кто подписал», «кто утвердил». Это факт о
 *     прошлом, передавать его некому и незачем; оно остаётся на надгробии.
 */

/**
 * Терминальные стадии сделки.
 *
 * Сравнение НЕ со списком значений: на проде вокабуляр смешанный — рядом живут
 * `WON`, `CLOSED_WON`, `LOST` и строчный `lead`. Список из двух значений молча
 * пропустил бы `CLOSED_WON`, а вместе с ним и десятки закрытых сделок в
 * передачу. Поэтому ищем подстроку без учёта регистра.
 */
const DEAL_TERMINAL_PATTERNS = ["won", "lost"]

/** Терминальные статусы лида. Здесь вокабуляр стабильно строчный. */
const LEAD_TERMINAL_STATUSES = ["converted", "lost"]

export interface HandoverCounts {
  deals: number
  leads: number
  tickets: number
  tasks: number
  projectTasks: number
  projects: number
  divisions: number
}

export function isEmptyHandover(counts: HandoverCounts): boolean {
  return Object.values(counts).every((n) => n === 0)
}

/**
 * Переносит незакрытую работу с одного пользователя на другого внутри
 * организации. Вызывать в транзакции вместе с обезличиванием: иначе можно
 * получить обезличенного владельца с непереданной работой.
 */
export async function handOverOpenWork(
  tx: Prisma.TransactionClient,
  { orgId, fromUserId, toUserId }: { orgId: string; fromUserId: string; toUserId: string },
): Promise<HandoverCounts> {
  const scope = { organizationId: orgId }

  // Сделки и лиды: у них `assignedTo` — обычная строка БЕЗ внешнего ключа,
  // поэтому база их никогда не сторожила. Отсюда и накопившиеся висяки.
  const deals = await tx.deal.updateMany({
    where: {
      ...scope,
      assignedTo: fromUserId,
      NOT: DEAL_TERMINAL_PATTERNS.map((p) => ({
        stage: { contains: p, mode: "insensitive" as const },
      })),
    },
    data: { assignedTo: toUserId },
  })

  const leads = await tx.lead.updateMany({
    where: {
      ...scope,
      assignedTo: fromUserId,
      NOT: LEAD_TERMINAL_STATUSES.map((s) => ({
        status: { equals: s, mode: "insensitive" as const },
      })),
    },
    data: { assignedTo: toUserId },
  })

  // Тикеты и задачи: опираемся на отметку времени, а не на строку статуса.
  // У `Task.status` в схеме прямо написано, что колонке доверять нельзя —
  // там смесь legacy-значений и Kanban-статусов. `completedAt`/`closedAt`
  // однозначны.
  const tickets = await tx.ticket.updateMany({
    where: { ...scope, assignedTo: fromUserId, closedAt: null },
    data: { assignedTo: toUserId },
  })

  const tasks = await tx.task.updateMany({
    where: { ...scope, assignedTo: fromUserId, completedAt: null },
    data: { assignedTo: toUserId },
  })

  const projectTasks = await tx.projectTask.updateMany({
    where: { ...scope, assignedTo: fromUserId, completedAt: null },
    data: { assignedTo: toUserId },
  })

  // Проект без руководителя и подразделение без главы — это не «история»,
  // а дыра в ответственности: у них по определению есть будущее.
  const projects = await tx.project.updateMany({
    where: { ...scope, managerId: fromUserId },
    data: { managerId: toUserId },
  })

  const divisions = await tx.division.updateMany({
    where: { ...scope, headUserId: fromUserId },
    data: { headUserId: toUserId },
  })

  return {
    deals: deals.count,
    leads: leads.count,
    tickets: tickets.count,
    tasks: tasks.count,
    projectTasks: projectTasks.count,
    projects: projects.count,
    divisions: divisions.count,
  }
}
