/**
 * CLM Slice 4c — Clause Governance: Deviation Detector
 *
 * Pure function — no DB access, no side effects.
 * Matches each template clause against the org's governed clause library
 * by exact title (case-sensitive) and produces deviation flag inputs.
 *
 * Severity precedence (per clause, highest wins):
 *   critical > warning > info
 *
 * Deviation types and their default severities:
 *   high_risk   → critical  (library clause is high_risk)
 *   retired     → critical  (library clause is retired)
 *   fallback    → warning   (library clause is a fallback variant)
 *   non_standard→ info      (clause title not found in library at all)
 *
 * A clause can produce at most one flag. When multiple conditions apply
 * (e.g. both high_risk and retired), the highest-severity flag wins.
 *
 * Duplicate-title handling: when multiple library clauses share the same
 * title, the title→clause index resolves to the HIGHEST-RISK member
 * (precedence: high_risk/retired > fallback > standard). This ensures a
 * benign duplicate can never mask a high_risk or retired governed clause.
 * Risk order: retired > high_risk > fallback > standard/other.
 */

export interface LibraryClause {
  id: string
  title: string
  /** "standard" | "fallback" | "high_risk" */
  riskLevel: string
  /** "draft" | "approved" | "retired" */
  status: string
  /** Plain-string self-reference: this clause is a fallback variant of the clause with this id. */
  fallbackOfClauseId: string | null
}

export interface TemplateClauseInput {
  title: string
}

export interface DeviationFlagInput {
  /** null for non_standard (no library match). */
  clauseId: string | null
  clauseTitle: string
  /** "high_risk" | "fallback" | "retired" | "non_standard" */
  deviationType: string
  /** "critical" | "warning" | "info" */
  severity: string
}

const SEVERITY_ORDER: Record<string, number> = {
  critical: 3,
  warning:  2,
  info:     1,
}

/**
 * Risk rank for a library clause — used when resolving duplicate titles.
 * Higher number = higher risk. A duplicate title always resolves to the
 * clause with the highest risk rank so that a benign duplicate can never
 * mask a high_risk or retired governed clause.
 *
 * Rank table:
 *   retired   → 4  (highest — triggers a critical flag and must not be masked)
 *   high_risk → 3
 *   fallback  → 2  (triggers a warning)
 *   anything else (standard, draft, etc.) → 1
 */
function clauseRiskRank(lc: LibraryClause): number {
  if (lc.status === "retired") return 4
  if (lc.riskLevel === "high_risk") return 3
  if (lc.fallbackOfClauseId != null) return 2
  return 1
}

/**
 * Detect clause deviations.
 *
 * @param templateClauses  The template's embedded clause array (needs only `.title`).
 * @param libraryClauses   The org's governed clause library (org-scoped at the call site).
 * @returns                Array of deviation flag inputs (one per deviating template clause).
 */
export function detectDeviations(
  templateClauses: TemplateClauseInput[],
  libraryClauses: LibraryClause[],
): DeviationFlagInput[] {
  // Index library by exact title for O(1) lookup.
  // When multiple clauses share a title, keep the HIGHEST-RISK one so that
  // a benign duplicate can never mask a high_risk or retired governed clause.
  // Risk precedence: retired(4) > high_risk(3) > fallback(2) > standard(1).
  const byTitle = new Map<string, LibraryClause>()
  for (const lc of libraryClauses) {
    const existing = byTitle.get(lc.title)
    if (!existing || clauseRiskRank(lc) > clauseRiskRank(existing)) {
      byTitle.set(lc.title, lc)
    }
  }

  const flags: DeviationFlagInput[] = []

  for (const tc of templateClauses) {
    const match = byTitle.get(tc.title)

    if (!match) {
      // Not in the governed library → non_standard (info).
      flags.push({
        clauseId:     null,
        clauseTitle:  tc.title,
        deviationType: "non_standard",
        severity:      "info",
      })
      continue
    }

    // Collect all conditions that apply and pick the highest-severity one.
    const candidates: DeviationFlagInput[] = []

    if (match.riskLevel === "high_risk") {
      candidates.push({
        clauseId:      match.id,
        clauseTitle:   tc.title,
        deviationType: "high_risk",
        severity:      "critical",
      })
    }

    if (match.status === "retired") {
      candidates.push({
        clauseId:      match.id,
        clauseTitle:   tc.title,
        deviationType: "retired",
        severity:      "critical",
      })
    }

    if (match.fallbackOfClauseId != null) {
      candidates.push({
        clauseId:      match.id,
        clauseTitle:   tc.title,
        deviationType: "fallback",
        severity:      "warning",
      })
    }

    if (candidates.length === 0) {
      // Standard approved clause — no flag.
      continue
    }

    // Pick the highest-severity candidate.
    const best = candidates.reduce((prev, curr) =>
      (SEVERITY_ORDER[curr.severity] ?? 0) > (SEVERITY_ORDER[prev.severity] ?? 0) ? curr : prev,
    )

    flags.push(best)
  }

  return flags
}
