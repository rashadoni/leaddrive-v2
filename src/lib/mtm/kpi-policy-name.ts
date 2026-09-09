/**
 * How an approved KPI policy is named on screen.
 *
 * Field UX audit 2026-09-05, task T14. The dashboard badge printed
 * `report.formula.policy.code` — a machine identifier like `COV-2026-Q3` — to a
 * manager reading a report in Russian or Azerbaijani. The identifier was never
 * the only thing available: `MtmKpiPolicy` carries `nameRu`, `nameAz` and
 * `nameEn`, filled in when the policy is created. Three translated names sat in
 * the database while the screen showed the code.
 *
 * The code is not useless — it is what a manager quotes when asking finance
 * about a number — so it stays reachable in the badge's tooltip. It just stops
 * being the label.
 */

export type MtmKpiPolicyNames = {
  nameRu?: string | null
  nameAz?: string | null
  nameEn?: string | null
  code: string
}

/**
 * The name for a locale, or the code when that locale has none.
 *
 * A blank name is treated as absent: the column is `String` and a policy
 * imported from another system can carry an empty one, and an empty badge is
 * worse than the identifier it replaced. English is the second choice because
 * every policy in this product is created through a form that requires it;
 * beyond that the code is the honest answer, not a name in a language the
 * reader did not ask for.
 */
export function mtmKpiPolicyName(policy: MtmKpiPolicyNames, locale: string | null | undefined): string {
  const base = String(locale ?? "").split("-")[0].toLowerCase()
  const byLocale: Record<string, string | null | undefined> = {
    ru: policy.nameRu,
    az: policy.nameAz,
    en: policy.nameEn,
  }
  const candidates = [byLocale[base], policy.nameEn]
  for (const candidate of candidates) {
    const name = typeof candidate === "string" ? candidate.trim() : ""
    if (name) return name
  }
  return policy.code
}

/**
 * True when the badge is showing the identifier because no name was found.
 * The caller uses it to decide whether repeating the code in the tooltip would
 * just say the same thing twice.
 */
export function mtmKpiPolicyNameIsCode(policy: MtmKpiPolicyNames, locale: string | null | undefined): boolean {
  return mtmKpiPolicyName(policy, locale) === policy.code
}
