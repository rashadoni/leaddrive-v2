/**
 * Professional Services Cloud — skill-matching engine.
 *
 * Given a project's required skills and a roster of users (each with
 * `User.skills: string[]` from the schema), rank candidates by skill
 * coverage. Pure functional — caller fetches users from Prisma and
 * passes them in.
 *
 * Slice 1 uses binary skill presence (string match). Slice 2 will add
 * proficiency levels (1-5) per skill — requires a `UserSkill` join
 * table with `proficiency` numeric and would change the matching score.
 *
 * Part of R12 Professional Services Cloud (Phase 2 slice 1).
 */

export interface CandidateUser {
  id: string
  name: string
  skills: string[]
  isActive: boolean
  isAvailable: boolean
}

export interface SkillMatchResult {
  userId: string
  name: string
  /** Skills the user has that match the requirement. */
  matchedSkills: string[]
  /** Skills required but missing from the user. */
  missingSkills: string[]
  /** Skills the user has beyond the requirement (signals over-qualification). */
  bonusSkills: string[]
  /** Match score 0-1 = matchedRequired / totalRequired. */
  score: number
  /** Convenience flag — does user cover every required skill? */
  fullyCovered: boolean
  /** isActive AND isAvailable. */
  available: boolean
}

export interface SkillMatchOptions {
  /** When true, exclude users with `isActive=false` from the result. Default true. */
  excludeInactive?: boolean
  /** When true, exclude users with `isAvailable=false`. Default false — slice 2 UI can filter. */
  excludeUnavailable?: boolean
  /** Cap the result list. Default 50. */
  limit?: number
}

/**
 * Match users against required skills. Returns candidates sorted by
 * `score` desc; within the same score, bonus skills (over-qualification)
 * tied-break ASC so we don't always promote senior people onto every job.
 */
export function matchUsersToSkills(
  users: CandidateUser[],
  requiredSkills: string[],
  options: SkillMatchOptions = {}
): SkillMatchResult[] {
  const required = requiredSkills.filter(s => s && s.trim().length > 0).map(normalize)
  const requiredSet = new Set(required)
  if (required.length === 0) return []

  const opts = {
    excludeInactive: options.excludeInactive ?? true,
    excludeUnavailable: options.excludeUnavailable ?? false,
    limit: options.limit ?? 50,
  }

  const filtered = users.filter(u => {
    if (opts.excludeInactive && !u.isActive) return false
    if (opts.excludeUnavailable && !u.isAvailable) return false
    return true
  })

  const ranked: SkillMatchResult[] = filtered.map(u => {
    const userSkills = (u.skills ?? []).map(normalize)
    const userSkillsSet = new Set(userSkills)
    const matched: string[] = []
    const missing: string[] = []
    for (const req of required) {
      if (userSkillsSet.has(req)) matched.push(req)
      else missing.push(req)
    }
    // Dedupe — user may have the same skill listed twice in their array.
    const bonus = Array.from(new Set(userSkills.filter(s => !requiredSet.has(s))))
    return {
      userId: u.id,
      name: u.name,
      matchedSkills: matched,
      missingSkills: missing,
      bonusSkills: bonus,
      score: required.length > 0 ? matched.length / required.length : 0,
      fullyCovered: missing.length === 0,
      available: u.isActive && u.isAvailable,
    }
  })

  // Sort: score desc primary, bonus ASC secondary (prefer right-fit), name ASC tertiary
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (a.bonusSkills.length !== b.bonusSkills.length) return a.bonusSkills.length - b.bonusSkills.length
    return a.name.localeCompare(b.name)
  })

  return ranked.slice(0, opts.limit)
}

function normalize(s: string): string {
  return s.trim().toLowerCase()
}

/**
 * Identify the gap: skills required by the project that NO user has.
 * Used by HR / partner-management dashboards to know what to hire next.
 */
export function findHiringGap(users: CandidateUser[], requiredSkills: string[]): string[] {
  const required = requiredSkills.map(normalize)
  const allUserSkills = new Set<string>()
  for (const u of users) {
    if (!u.isActive) continue
    for (const s of u.skills ?? []) allUserSkills.add(normalize(s))
  }
  return required.filter(r => !allUserSkills.has(r))
}
