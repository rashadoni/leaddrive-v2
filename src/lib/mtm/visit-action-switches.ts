/**
 * The visit actions of an organization as two switches each: shown to the
 * agent, and required to finish the visit.
 *
 * The rules behind them are not new. Every visit action has had three states
 * — required, optional, hidden — in "visit action policies", an editor with a
 * rule list, groups, visit types, dates, priorities, minimum counts, customer
 * conditions and a preview. Owner, 2026-10-07, shown that editor: «я хочу,
 * чтоб ты этот раздел настолько улучшил в плане интуитивности, что
 * среднестатистический пользователь с первого раза смог понять, и компактно
 * сделай… обычные переключатели ставь, ползунки».
 *
 * The switches read and write the same rules through the same API: the
 * organization-wide rule for the default visit type. Rules for one group or a
 * special visit type stay in the full editor, one click below.
 *
 * Pure: no React, no fetch.
 */

export type VisitSwitchMode = "REQUIRED" | "OPTIONAL" | "HIDDEN"

/** The actions a field agent can meet in a visit, in the order the block lists them. */
export const VISIT_SWITCH_ACTION_KEYS = ["PHOTO", "PRESENTATION", "SIGNATURE", "VISIT_NOTE", "STOCK_CHECK", "FEEDBACK"] as const
export type VisitSwitchActionKey = typeof VISIT_SWITCH_ACTION_KEYS[number]

export interface VisitSwitchAction {
  actionKey: string
  mode: VisitSwitchMode
  minCount: number
  conditions: { customerCategories?: string[]; objectTypes?: string[] } | null
  allowWaiver: boolean
}

export interface VisitSwitchRule {
  id?: string
  teamId: string | null
  visitType: string
  priority: number
  effectiveFrom: string
  effectiveTo: string | null
  isActive: boolean
  actions: VisitSwitchAction[]
}

function inEffect(rule: VisitSwitchRule, now: Date): boolean {
  if (!rule.isActive) return false
  const from = new Date(rule.effectiveFrom).getTime()
  if (Number.isFinite(from) && from > now.getTime()) return false
  if (!rule.effectiveTo) return true
  const to = new Date(rule.effectiveTo).getTime()
  return !Number.isFinite(to) || to >= now.getTime()
}

/**
 * The rule an agent gets when nothing more specific applies to him: for every
 * group, for the default visit type, in effect now. Picked in the resolver's
 * own order (`resolveMtmVisitPolicy`): lowest priority number first, then the
 * most recent start.
 */
export function companyVisitRule<T extends VisitSwitchRule>(rules: readonly T[], now: Date = new Date()): T | null {
  const candidates = rules.filter((rule) => rule.teamId === null && rule.visitType.toUpperCase() === "DEFAULT" && inEffect(rule, now))
  candidates.sort((left, right) => left.priority - right.priority
    || new Date(right.effectiveFrom).getTime() - new Date(left.effectiveFrom).getTime())
  return candidates[0] ?? null
}

/** Rules in effect that can give somebody something other than the company rule. */
export function specialVisitRuleCount(rules: readonly VisitSwitchRule[], now: Date = new Date()): number {
  const company = companyVisitRule(rules, now)
  return rules.filter((rule) => rule !== company && inEffect(rule, now)).length
}

/**
 * What the server falls back to while an organization has no rule at all.
 * `photoRequired` is the setting older than the rules («photo required on
 * every visit»): the resolver still honours it then, and only then. Its own
 * switch is gone from the settings page, so the photo row must show it —
 * otherwise the row would read «not required» for a photo the server requires.
 */
export interface VisitSwitchDefaults { legacyPhotoRequired?: boolean }

function modeWithoutRule(actionKey: string, defaults: VisitSwitchDefaults | undefined): VisitSwitchMode {
  return actionKey === "PHOTO" && defaults?.legacyPhotoRequired === true ? "REQUIRED" : "OPTIONAL"
}

/** What the two switches of an action show. An action a rule does not mention is optional — the server's default. */
export function visitSwitchState(
  rule: VisitSwitchRule | null,
  actionKey: string,
  defaults?: VisitSwitchDefaults,
): { shown: boolean; required: boolean; conditional: boolean } {
  const action = rule?.actions.find((candidate) => candidate.actionKey === actionKey)
  const mode = action?.mode ?? (rule ? "OPTIONAL" : modeWithoutRule(actionKey, defaults))
  const conditions = action?.conditions
  return {
    shown: mode !== "HIDDEN",
    required: mode === "REQUIRED",
    conditional: Boolean(conditions && ((conditions.customerCategories?.length ?? 0) > 0 || (conditions.objectTypes?.length ?? 0) > 0)),
  }
}

/** A hidden action cannot be required: nobody can do what he is not shown. */
export function visitModeFromSwitches(shown: boolean, required: boolean): VisitSwitchMode {
  if (!shown) return "HIDDEN"
  return required ? "REQUIRED" : "OPTIONAL"
}

/**
 * The actions to store after one switch moved. Everything else about every
 * action — its minimum, its customer conditions, whether a reason may replace
 * it — stays exactly as the rule had it; an action the rule did not list yet
 * joins with the server's defaults.
 */
export function visitActionsAfterSwitch(
  rule: VisitSwitchRule | null,
  actionKey: VisitSwitchActionKey,
  change: { shown?: boolean; required?: boolean },
  defaults?: VisitSwitchDefaults,
): VisitSwitchAction[] {
  const stored = rule?.actions ?? []
  const keys = [...new Set<string>([...VISIT_SWITCH_ACTION_KEYS, ...stored.map((action) => action.actionKey)])]
  return keys.map((key) => {
    const current: VisitSwitchAction = stored.find((action) => action.actionKey === key)
      // The first rule of an organization starts from what applied without one,
      // so creating it by one switch does not quietly lift a required photo.
      ?? { actionKey: key, mode: rule ? "OPTIONAL" : modeWithoutRule(key, defaults), minCount: 1, conditions: null, allowWaiver: false }
    if (key !== actionKey) return current
    const before = visitSwitchState(rule, key, defaults)
    const shown = change.shown ?? before.shown
    // Switching «shown» back on returns an optional action, not the required one it may once have been.
    const required = change.shown !== undefined ? false : (change.required ?? before.required)
    return { ...current, mode: visitModeFromSwitches(shown, shown && required) }
  })
}
