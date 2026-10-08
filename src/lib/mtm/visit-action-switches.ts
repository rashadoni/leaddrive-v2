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
 * organization-wide rule for the default visit type. A rule for one group of
 * agents is the same table of switches, one click below («special rules»).
 *
 * 2026-10-08 the old editor went altogether (owner, shown it once more: «эту
 * часть ты оставил без изменений»). Of what it offered per action, the table
 * keeps what somebody acts on — the minimum number of photos, and «only at
 * clients of this class / this kind», both applied by the server. It does not
 * offer «a reason may replace it» (the app has no way to give that reason) and
 * a minimum for anything but photos (the server counts one of each); a rule
 * that already stores them keeps them untouched.
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
 * The rules «special rules» lists: every rule that is switched on and has not
 * ended, except the company rule (that one is the switches above). A rule that
 * starts later is listed too — somebody wrote it and must be able to find it.
 */
export function listedSpecialVisitRules<T extends VisitSwitchRule>(rules: readonly T[], now: Date = new Date()): T[] {
  const company = companyVisitRule(rules, now)
  return rules.filter((rule) => {
    if (rule === company || !rule.isActive) return false
    if (!rule.effectiveTo) return true
    const to = new Date(rule.effectiveTo).getTime()
    return !Number.isFinite(to) || to >= now.getTime()
  })
}

/** The priority every rule written from the settings page gets. Among equals the resolver prefers a group's own rule. */
export const SPECIAL_RULE_PRIORITY = 100

/**
 * The server refuses two active rules for the same group, visit type and
 * priority whose dates overlap (`MTM_POLICY_WINDOW_CONFLICT`). A new special
 * rule is always for the default visit type at the default priority, so a
 * group that already has such a rule is not offered again.
 */
export function teamsWithoutSpecialVisitRule<T extends { id: string }>(
  teams: readonly T[],
  rules: readonly VisitSwitchRule[],
  now: Date = new Date(),
): T[] {
  const taken = new Set(listedSpecialVisitRules(rules, now)
    .filter((rule) => rule.teamId !== null && rule.visitType.toUpperCase() === "DEFAULT" && rule.priority === SPECIAL_RULE_PRIORITY)
    .map((rule) => rule.teamId as string))
  return teams.filter((team) => !taken.has(team.id))
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
  // The first rule of an organization starts from what applied without one
  // (`visitRuleActions`), so creating it by one switch does not quietly lift
  // a required photo.
  return visitRuleActions(rule, defaults).map((current) => {
    const key = current.actionKey
    if (key !== actionKey) return current
    const before = visitSwitchState(rule, key, defaults)
    const shown = change.shown ?? before.shown
    // Switching «shown» back on returns an optional action, not the required one it may once have been.
    const required = change.shown !== undefined ? false : (change.required ?? before.required)
    return { ...current, mode: visitModeFromSwitches(shown, shown && required) }
  })
}


/** What a rule says about every action the table lists: stored, or the default an unlisted action gets. */
export function visitRuleActions(rule: VisitSwitchRule | null, defaults?: VisitSwitchDefaults): VisitSwitchAction[] {
  const stored = rule?.actions ?? []
  const keys = [...new Set<string>([...VISIT_SWITCH_ACTION_KEYS, ...stored.map((action) => action.actionKey)])]
  return keys.map((key) => stored.find((action) => action.actionKey === key)
    ?? { actionKey: key, mode: rule ? "OPTIONAL" : modeWithoutRule(key, defaults), minCount: 1, conditions: null, allowWaiver: false })
}

/** The refinements of one action that the server acts on. */
export interface VisitActionDetail {
  /** Only photos are counted; every other action is done once. */
  minCount: number
  /** «Only at clients of this class» — null for any. */
  customerClass: string | null
  /** «Only at clients of this kind» — null for any. */
  clientKind: string | null
}

export function visitActionDetail(rule: VisitSwitchRule | null, actionKey: string): VisitActionDetail {
  const action = rule?.actions.find((candidate) => candidate.actionKey === actionKey)
  return {
    minCount: Math.max(1, Math.trunc(action?.minCount ?? 1)),
    customerClass: action?.conditions?.customerCategories?.[0] ?? null,
    clientKind: action?.conditions?.objectTypes?.[0] ?? null,
  }
}

/** Whether a refinement is set at all, so a row can say so without being opened. */
export function visitActionRefined(rule: VisitSwitchRule | null, actionKey: string): boolean {
  const detail = visitActionDetail(rule, actionKey)
  return detail.customerClass !== null || detail.clientKind !== null || (actionKey === "PHOTO" && detail.minCount > 1)
}

/**
 * The actions to store after one refinement changed. Like a switch, it changes
 * the one thing it names: the mode, the waiver and every other action stay.
 */
export function visitActionsAfterDetail(
  rule: VisitSwitchRule | null,
  actionKey: VisitSwitchActionKey,
  change: Partial<VisitActionDetail>,
  defaults?: VisitSwitchDefaults,
): VisitSwitchAction[] {
  return visitRuleActions(rule, defaults).map((current) => {
    if (current.actionKey !== actionKey) return current
    const conditions: NonNullable<VisitSwitchAction["conditions"]> = { ...(current.conditions ?? {}) }
    if (change.customerClass !== undefined) {
      if (change.customerClass) conditions.customerCategories = [change.customerClass]
      else delete conditions.customerCategories
    }
    if (change.clientKind !== undefined) {
      if (change.clientKind) conditions.objectTypes = [change.clientKind]
      else delete conditions.objectTypes
    }
    const minCount = change.minCount === undefined || !Number.isFinite(change.minCount)
      ? current.minCount
      : Math.min(100, Math.max(1, Math.trunc(change.minCount)))
    return { ...current, minCount, conditions: Object.keys(conditions).length ? conditions : null }
  })
}
