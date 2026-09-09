/**
 * S4 Territory Rules — pure matching helper.
 *
 * Determines whether a Company (or any object carrying country / industry /
 * employeeCount) matches a territory's rules JSON.
 *
 * S4-auto-assign DONE: findMatchingTerritories() is wired into the Company
 * create route (POST /api/v1/companies) via lib/territory-routing.ts —
 * matching territories' member reps get notified on company create. (A hard
 * company↔territory ownership link is a future slice; today routing = notify,
 * since Company has no territoryId column.)
 *
 * TerritoryRules shape:
 * {
 *   countries?:      string[]   // ISO-3166-1 alpha-2 codes; empty = any
 *   industries?:     string[]   // freeform tags matching Company.industry; empty = any
 *   companySizeMin?: number     // min employee count (inclusive)
 *   companySizeMax?: number     // max employee count (inclusive); 0 = no upper limit
 * }
 *
 * An empty rules object `{}` matches every company.
 * Each non-empty dimension narrows the match (AND semantics between dimensions).
 * Within countries / industries arrays the match is OR.
 */

export interface TerritoryRules {
  countries?: string[]
  industries?: string[]
  companySizeMin?: number
  companySizeMax?: number
}

export interface CompanyProfile {
  country?: string | null
  industry?: string | null
  employeeCount?: number | null
}

/**
 * Returns true if `profile` satisfies all non-empty dimensions in `rules`.
 * Called per-territory when checking whether to auto-assign a new Company.
 */
export function matchTerritoryRules(
  rules: TerritoryRules,
  profile: CompanyProfile
): boolean {
  // Country filter
  if (rules.countries && rules.countries.length > 0) {
    if (!profile.country) return false
    if (!rules.countries.includes(profile.country.toUpperCase())) return false
  }

  // Industry filter
  if (rules.industries && rules.industries.length > 0) {
    if (!profile.industry) return false
    const profileIndustry = profile.industry.toLowerCase()
    const match = rules.industries.some(
      (ind) => ind.toLowerCase() === profileIndustry
    )
    if (!match) return false
  }

  // Company size — min
  if (
    rules.companySizeMin !== undefined &&
    rules.companySizeMin > 0
  ) {
    if (
      profile.employeeCount === null ||
      profile.employeeCount === undefined
    )
      return false
    if (profile.employeeCount < rules.companySizeMin) return false
  }

  // Company size — max (0 = disabled)
  if (
    rules.companySizeMax !== undefined &&
    rules.companySizeMax > 0
  ) {
    if (
      profile.employeeCount === null ||
      profile.employeeCount === undefined
    )
      return false
    if (profile.employeeCount > rules.companySizeMax) return false
  }

  return true
}

/**
 * Given a list of territories (each carrying their rules JSON), return the IDs
 * of all territories whose rules match the profile.
 *
 * Used by the Company create handler to decide which territories to flag.
 */
export function findMatchingTerritories(
  territories: Array<{ id: string; rules: unknown }>,
  profile: CompanyProfile
): string[] {
  return territories
    .filter((t) => {
      const rules = (t.rules ?? {}) as TerritoryRules
      return matchTerritoryRules(rules, profile)
    })
    .map((t) => t.id)
}
