import { prisma } from "@/lib/prisma"
import { createNotification } from "@/lib/notifications"

/**
 * Who hears about a purchase, and in their own language
 * (docs/sales-procurement/README.md, task 6.3).
 *
 * Each event names its recipients by user id; the notice is written per person,
 * in the person's `preferredLanguage` (ru / az / en, Azerbaijani when unset), to
 * the bell with a push. Errors never reach the caller: a purchase is saved
 * whether or not a notice could be written.
 */
type Lang = "ru" | "az" | "en"

export type ProcurementEvent =
  | { kind: "request.submitted"; number: string; title: string }
  | { kind: "order.pending_approval"; number: string; supplier: string }
  | { kind: "order.approved"; number: string; supplier: string }
  | { kind: "order.rejected"; number: string; supplier: string; reason?: string | null }
  | { kind: "order.sent"; number: string; supplier: string }
  | { kind: "order.status"; number: string; supplier: string; status: "in_production" | "in_transit" }
  | { kind: "order.received"; number: string; supplier: string; partial: boolean }
  | { kind: "order.delivery_moved"; number: string; supplier: string; date: string }
  | { kind: "order.overdue"; number: string; supplier: string; date: string }
  | { kind: "order.cancelled"; number: string; supplier: string }
  | { kind: "deal.changed"; number: string; deal: string; change: string }

const STATUS_WORDS: Record<Lang, Record<"in_production" | "in_transit", string>> = {
  ru: { in_production: "в производстве", in_transit: "в пути" },
  az: { in_production: "istehsaldadır", in_transit: "yoldadır" },
  en: { in_production: "in production", in_transit: "in transit" },
}

function words(lang: Lang, event: ProcurementEvent): { title: string; message: string; type: "info" | "warning" | "success" } {
  const ru = lang === "ru"
  const az = lang === "az"
  const pick = (r: string, a: string, e: string) => (ru ? r : az ? a : e)
  switch (event.kind) {
    case "request.submitted":
      return { type: "info", title: pick(`Заявка на закупку ${event.number}`, `Satınalma sorğusu ${event.number}`, `Purchase request ${event.number}`), message: event.title }
    case "order.pending_approval":
      return { type: "info", title: pick(`Согласуйте заказ ${event.number}`, `${event.number} sifarişini təsdiqləyin`, `Approve order ${event.number}`), message: event.supplier }
    case "order.approved":
      return { type: "success", title: pick(`Заказ ${event.number} согласован`, `${event.number} sifarişi təsdiqləndi`, `Order ${event.number} approved`), message: event.supplier }
    case "order.rejected":
      return { type: "warning", title: pick(`Заказ ${event.number} отклонён`, `${event.number} sifarişi rədd edildi`, `Order ${event.number} rejected`), message: event.reason ? `${event.supplier}: ${event.reason}` : event.supplier }
    case "order.sent":
      return { type: "info", title: pick(`Заказ ${event.number} отправлен поставщику`, `${event.number} sifarişi təchizatçıya göndərildi`, `Order ${event.number} sent to the supplier`), message: event.supplier }
    case "order.status":
      return { type: "info", title: pick(`Заказ ${event.number}: ${STATUS_WORDS.ru[event.status]}`, `${event.number} sifarişi ${STATUS_WORDS.az[event.status]}`, `Order ${event.number}: ${STATUS_WORDS.en[event.status]}`), message: event.supplier }
    case "order.received":
      return event.partial
        ? { type: "info", title: pick(`Заказ ${event.number} принят частично`, `${event.number} sifarişi qismən qəbul edildi`, `Order ${event.number} partly received`), message: event.supplier }
        : { type: "success", title: pick(`Заказ ${event.number} принят`, `${event.number} sifarişi qəbul edildi`, `Order ${event.number} received`), message: event.supplier }
    case "order.delivery_moved":
      return { type: "warning", title: pick(`Новый срок заказа ${event.number}: ${event.date}`, `${event.number} sifarişinin yeni müddəti: ${event.date}`, `New date for order ${event.number}: ${event.date}`), message: event.supplier }
    case "order.overdue":
      return { type: "warning", title: pick(`Заказ ${event.number} опаздывает`, `${event.number} sifarişi gecikir`, `Order ${event.number} is late`), message: pick(`${event.supplier}, срок был ${event.date}`, `${event.supplier}, müddət ${event.date} idi`, `${event.supplier}, due ${event.date}`) }
    case "order.cancelled":
      return { type: "warning", title: pick(`Заказ ${event.number} отменён`, `${event.number} sifarişi ləğv edildi`, `Order ${event.number} cancelled`), message: event.supplier }
    case "deal.changed":
      return { type: "warning", title: pick(`Сделка изменилась — проверьте ${event.number}`, `Sövdələşmə dəyişdi — ${event.number} yoxlayın`, `The deal changed — check ${event.number}`), message: `${event.deal}: ${event.change}` }
  }
}

function langOf(value: string | null | undefined): Lang {
  return value === "ru" || value === "en" ? value : "az"
}

export async function notifyProcurement(input: {
  orgId: string
  recipients: Iterable<string | null | undefined>
  /** Never notified about their own action. */
  actorId?: string | null
  event: ProcurementEvent
  entityType: "purchase_request" | "purchase_order"
  entityId: string
}): Promise<void> {
  const ids = [...new Set([...input.recipients].filter((id): id is string => !!id && id !== input.actorId))]
  if (ids.length === 0) return
  try {
    const people = await prisma.user.findMany({
      where: { organizationId: input.orgId, id: { in: ids }, isActive: true },
      select: { id: true, preferredLanguage: true },
    })
    await Promise.all(people.map((person) => {
      const text = words(langOf(person.preferredLanguage), input.event)
      return createNotification({
        organizationId: input.orgId,
        userId: person.id,
        type: text.type,
        title: text.title,
        message: text.message,
        entityType: input.entityType,
        entityId: input.entityId,
        push: true,
        kind: `procurement.${input.event.kind}`,
      }).catch(() => undefined)
    }))
  } catch {
    // A notice is never a reason to fail the purchase that caused it.
  }
}

/** Everyone holding one of these roles in the organization. */
export async function usersWithRoles(orgId: string, roles: readonly string[]): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: { organizationId: orgId, role: { in: [...roles] }, isActive: true },
    select: { id: true },
  })
  return rows.map((row) => row.id)
}

/**
 * Who works purchases: people with the role «Закупки»; an organization that has
 * none yet is run by its managers, and failing those by its administrators.
 */
export async function purchasersOf(orgId: string): Promise<string[]> {
  for (const roles of [["procurement"], ["manager"], ["admin"]]) {
    const ids = await usersWithRoles(orgId, roles)
    if (ids.length > 0) return ids
  }
  return []
}
