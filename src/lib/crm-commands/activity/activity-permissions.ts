import type { Module } from "@/lib/permissions"

/**
 * Какие права нужны, чтобы писать в ленту карточки: право писать в саму
 * карточку. До 2026-11-09 маршрут не спрашивал прав вовсе — заметку или
 * звонок в контакт, сделку или лид мог записать и наблюдатель; голос с этапа 3
 * проверял, экран — нет. Запись без карточки — как раньше.
 */
const RECORD_MODULES: Readonly<Record<string, Module>> = {
  contact: "contacts",
  company: "companies",
  deal: "deals",
  lead: "leads",
  ticket: "tickets",
}

export function activityWriteModules(body: unknown): Module[] {
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {}
  const modules = new Set<Module>()
  if (typeof input.contactId === "string" && input.contactId) modules.add("contacts")
  if (typeof input.companyId === "string" && input.companyId) modules.add("companies")
  if (typeof input.relatedType === "string" && RECORD_MODULES[input.relatedType]) modules.add(RECORD_MODULES[input.relatedType])
  return [...modules]
}
