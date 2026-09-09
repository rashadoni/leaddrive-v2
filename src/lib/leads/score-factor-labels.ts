export type LeadScoreFactorTranslationKey =
  | "factorRecency"
  | "factorDealPotential"
  | "factorSourceQuality"
  | "factorEngagement"
  | "factorCompleteness"
  | "modalEmail"
  | "modalPhone"
  | "modalCompany"
  | "modalSource"
  | "modalPriority"
  | "modalEstimatedValue"
  | "modalStatus"
  | "modalNotes"

const FACTOR_TRANSLATION_KEYS: Record<string, LeadScoreFactorTranslationKey> = {
  recency: "factorRecency",
  dealpotential: "factorDealPotential",
  sourcequality: "factorSourceQuality",
  engagementlevel: "factorEngagement",
  contactcompleteness: "factorCompleteness",
  email: "modalEmail",
  phone: "modalPhone",
  company: "modalCompany",
  source: "modalSource",
  priority: "modalPriority",
  value: "modalEstimatedValue",
  status: "modalStatus",
  notes: "modalNotes",
}

function normalizeFactorKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase()
}

function humanizeFactorKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key
}

export function getLeadScoreFactorLabel(
  factorKey: string,
  translate: (key: LeadScoreFactorTranslationKey) => string,
): string {
  const translationKey = FACTOR_TRANSLATION_KEYS[normalizeFactorKey(factorKey)]
  return translationKey ? translate(translationKey) : humanizeFactorKey(factorKey)
}
