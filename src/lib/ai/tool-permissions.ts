import { checkPermission, type Module, type Role } from "@/lib/permissions"
import { activityWriteModules } from "@/lib/crm-commands/activity/activity-permissions"

/**
 * Права на действия ИИ — одно правило в ядре, для всех организаций сразу.
 *
 * До 2026-11-10 исполнитель действий Da Vinci (`executeTool`) не спрашивал роль
 * вовсе: сотрудник поддержки или наблюдатель, которому сделки закрыты, писал
 * «переведи сделку в выигранные» — и сделка переводилась. Карточку одобрения
 * письма или правки контакта мог нажать тот же наблюдатель. Модель вероятностна
 * и уговаривается, поэтому что можно делать, решает не она и не промпт, а этот
 * код: то же право, которое спрашивает обычный экран CRM для того же действия.
 *
 * Каждое пишущее действие ИИ обязано иметь здесь правило. Действие без правила
 * не выполняется (отказ, а не «разрешено»), и тест
 * `lib-ai-tool-permissions.test.ts` краснеет, если в `TOOL_META` появилось
 * пишущее действие, которого нет в `AI_WRITE_TOOL_RULES`.
 */

/** Карточка, к которой пишется заметка, → право на её запись. */
const NOTE_ENTITY_MODULES: Readonly<Record<string, Module>> = {
  contact: "contacts",
  company: "companies",
  deal: "deals",
}

type Input = Record<string, unknown>

/**
 * Какие права на запись нужны действию с этими аргументами. `null` — аргументы
 * не позволяют понять, во что пишется действие, и оно запрещено.
 */
export const AI_WRITE_TOOL_RULES: Readonly<Record<string, (input: Input) => Module[] | null>> = {
  // Заметка всегда пишется в карточку: без известной карточки — отказ.
  add_note: (input) => {
    const mod = typeof input.entityType === "string" ? NOTE_ENTITY_MODULES[input.entityType] : undefined
    return mod ? [mod] : null
  },
  // Как POST /api/v1/activities: право писать в карточку, к которой привязана запись.
  log_activity: (input) => activityWriteModules(input),
  // Как POST /api/v1/tasks.
  create_task: () => ["tasks"],
  // Как PUT /api/v1/deals/[id] и POST /api/v1/deals.
  update_deal_stage: () => ["deals"],
  create_deal: () => ["deals"],
  // Как POST /api/v1/tickets.
  create_ticket: () => ["tickets"],
  // Как PUT /api/v1/contacts/[id].
  update_contact: () => ["contacts"],
  // Письмо клиенту от имени компании — действие над отношениями с контактом.
  send_email: () => ["contacts"],
}

export type AiToolPermissionDenial = { allowed: false; missing: Module[] | "unknown_target" | "no_role" | "no_rule" }
export type AiToolPermissionVerdict = { allowed: true } | AiToolPermissionDenial

/** Может ли эта роль выполнить это пишущее действие ИИ с этими аргументами. */
export function aiWriteToolPermission(
  role: Role | undefined | null,
  toolName: string,
  input: unknown,
): AiToolPermissionVerdict {
  if (!role) return { allowed: false, missing: "no_role" }
  const rule = AI_WRITE_TOOL_RULES[toolName]
  if (!rule) return { allowed: false, missing: "no_rule" }
  const args = input && typeof input === "object" ? input as Input : {}
  const modules = rule(args)
  if (!modules) return { allowed: false, missing: "unknown_target" }
  const missing = modules.filter((mod) => !checkPermission(role, mod, "write"))
  return missing.length === 0 ? { allowed: true } : { allowed: false, missing }
}

/**
 * Предлагать ли действие модели вовсе. Аргументов ещё нет, поэтому смотрится
 * право, без которого действие не выполнится никогда; окончательно решает
 * `aiWriteToolPermission` при вызове. Для заметки и записи в ленту это значит
 * «может писать хотя бы в одну карточку» — дальше их режет вызов.
 */
export function aiWriteToolOffered(role: Role | undefined | null, toolName: string): boolean {
  if (!role) return false
  switch (toolName) {
    case "add_note":
      return Object.values(NOTE_ENTITY_MODULES).some((mod) => checkPermission(role, mod, "write"))
    case "log_activity":
      return true
    default:
      return aiWriteToolPermission(role, toolName, {}).allowed
  }
}

/** Отказ словами — его читает модель (и пересказывает человеку) и журнал. */
export function aiToolDenialMessage(denial: AiToolPermissionDenial): string {
  if (denial.missing === "no_role" || denial.missing === "no_rule") {
    return "This action is not available to the assistant."
  }
  if (denial.missing === "unknown_target") {
    return "This action needs a known record to write to."
  }
  return `Your role is not allowed to change: ${denial.missing.join(", ")}. Tell the user they lack this permission; do not retry.`
}
