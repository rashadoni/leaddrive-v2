export const MACRO_ACTION_TYPES = [
  "set_status",
  "set_priority",
  "set_assignee",
  "add_comment",
  "add_internal_note",
  "add_tag",
  "remove_tag",
] as const

export const MACRO_DEFAULT_CATEGORIES = ["general", "billing", "technical", "onboarding", "sales"] as const
export const MACRO_SETTINGS_KEY = "ticketMacroCategories"
export const MACRO_ASSIGNABLE_ROLES = ["superadmin", "admin", "manager", "agent", "support", "ticketing"] as const

export type MacroActionType = typeof MACRO_ACTION_TYPES[number]

export interface MacroAction {
  type: MacroActionType
  value: string
}

export interface MacroRecord {
  id: string
  name: string
  description: string | null
  category: string
  actions: MacroAction[]
  shortcutKey: string | null
  usageCount: number
  isActive: boolean
  sortOrder: number
}

export interface MacroAgent {
  id: string
  name: string
  role: string
  isActive: boolean
  isAvailable: boolean
}

export function canManageTicketMacros(role: string): boolean {
  return role === "superadmin" || role === "admin" || role === "manager"
}

export function normalizeMacroCategory(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 80)
}

export function uniqueMacroCategories(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of values) {
    const category = normalizeMacroCategory(raw)
    const key = category.toLocaleLowerCase()
    if (!category || seen.has(key)) continue
    seen.add(key)
    result.push(category)
  }
  return result
}

export function customMacroCategoriesFromSettings(settings: unknown): string[] {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return []
  const value = (settings as Record<string, unknown>)[MACRO_SETTINGS_KEY]
  return Array.isArray(value) ? uniqueMacroCategories(value.filter((item): item is string => typeof item === "string")) : []
}

export function allMacroCategories(settings: unknown, usedCategories: readonly string[] = []): string[] {
  return uniqueMacroCategories([
    ...MACRO_DEFAULT_CATEGORIES,
    ...customMacroCategoriesFromSettings(settings),
    ...usedCategories,
  ])
}

export function settingsWithMacroCategories(settings: unknown, categories: readonly string[]): Record<string, unknown> {
  const current = settings && typeof settings === "object" && !Array.isArray(settings)
    ? settings as Record<string, unknown>
    : {}
  const defaultKeys = new Set(MACRO_DEFAULT_CATEGORIES.map((category) => category.toLocaleLowerCase()))
  return {
    ...current,
    [MACRO_SETTINGS_KEY]: uniqueMacroCategories(categories).filter((category) => !defaultKeys.has(category.toLocaleLowerCase())),
  }
}

export function moveMacroAction(actions: readonly MacroAction[], index: number, direction: "up" | "down"): MacroAction[] {
  const target = direction === "up" ? index - 1 : index + 1
  if (index < 0 || index >= actions.length || target < 0 || target >= actions.length) return [...actions]
  const next = [...actions]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export function macroMatchesQuery(macro: MacroRecord, query: string, category: string, status: "all" | "active" | "inactive"): boolean {
  const needle = query.trim().toLocaleLowerCase()
  const matchesText = !needle || [macro.name, macro.description ?? "", macro.category]
    .some((value) => value.toLocaleLowerCase().includes(needle))
  const matchesCategory = category === "all" || macro.category.toLocaleLowerCase() === category.toLocaleLowerCase()
  const matchesStatus = status === "all" || macro.isActive === (status === "active")
  return matchesText && matchesCategory && matchesStatus
}

export function actionAssigneeIds(actions: readonly MacroAction[]): string[] {
  return Array.from(new Set(actions
    .filter((action) => action.type === "set_assignee")
    .map((action) => action.value.trim())
    .filter(Boolean)))
}
