/**
 * What a manager rates on a joint visit (owner-approved mockup, 2026-10-20),
 * in the order every screen shows them. Kept free of server imports: the web
 * pages read it too. The rules around it live in src/lib/mtm/joint-visit.ts.
 */
export const MTM_VISIT_EVALUATION_CRITERIA = [
  "PREPARATION",
  "RAPPORT",
  "NEEDS",
  "PRESENTATION",
  "OBJECTIONS",
  "CLOSING",
] as const

export type MtmVisitEvaluationCriterion = (typeof MTM_VISIT_EVALUATION_CRITERIA)[number]
export type MtmVisitEvaluationScores = Partial<Record<MtmVisitEvaluationCriterion, number>>
