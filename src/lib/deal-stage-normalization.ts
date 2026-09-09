function foldStage(value: string): string {
  return value
    .trim()
    .replace(/[ıİ]/g, "i")
    .replace(/[əƏ]/g, "e")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase()
}

const WON_ALIASES = new Set([
  "WON",
  "CLOSED_WON",
  "CLOSE_WON",
  "QAZANDI",
  "QAZANILDI",
  "VYIGRANO",
  "SUCCESS",
])

const LOST_ALIASES = new Set([
  "LOST",
  "CLOSED_LOST",
  "CLOSE_LOST",
  "UDUZDU",
  "UDUZULDU",
  "PROIGRANO",
  "FAILED",
])

const OPEN_ALIASES: Record<string, string> = {
  LEAD: "LEAD",
  LID: "LEAD",
  NEW: "LEAD",
  YENI: "LEAD",
  QUALIFIED: "QUALIFIED",
  QUALIFICATION: "QUALIFIED",
  KVALIFIKASIYA: "QUALIFIED",
  PROPOSAL: "PROPOSAL",
  TEKLIF: "PROPOSAL",
  NEGOTIATION: "NEGOTIATION",
  DANISIQLAR: "NEGOTIATION",
}

/**
 * Canonical reporting key for a deal stage.
 *
 * Pipeline stages remain fully custom in CRM. Reports, however, must merge
 * configured/localized aliases such as `CLOSED_WON` and `Qazandı` into one
 * logical bucket instead of displaying duplicate won/lost rows.
 */
export function canonicalDealStage(
  stage: string,
  wonStageNames: Iterable<string> = [],
  lostStageNames: Iterable<string> = [],
): string {
  const folded = foldStage(stage)
  const won = new Set(Array.from(wonStageNames, foldStage))
  const lost = new Set(Array.from(lostStageNames, foldStage))

  if (won.has(folded) || WON_ALIASES.has(folded)) return "WON"
  if (lost.has(folded) || LOST_ALIASES.has(folded)) return "LOST"
  return OPEN_ALIASES[folded] || stage.trim()
}

export type StageVocabulary = {
  /** Every spelling stored in this org that means closed-won. */
  wonStages: string[]
  /** Every spelling stored in this org that means closed-lost. */
  lostStages: string[]
  /** Won ∪ lost — the deals that are no longer in the open pipeline. */
  closedStages: string[]
}

/**
 * Turn the stage spellings an org actually stores into filters for `where`.
 *
 * `canonicalDealStage` folds a single value, which is enough for grouping rows
 * already fetched, but a query has to name the strings up front. Callers used
 * to write `stage: "WON"` instead, and that is a bug wherever a second spelling
 * exists — in production `WON` and `CLOSED_WON` coexist, so the literal filter
 * both dropped the largest won deal from revenue and left it sitting in the
 * open pipeline.
 *
 * Three sources, all of them required:
 *  - the configured names, because a stage the org declared won stays won even
 *    while no deal sits in it — dropping it would make the set shrink and grow
 *    as deals move, and a filter that depends on today's data is not a filter;
 *  - the stored spellings, because imports and seeds write values nobody
 *    configured, which is how `CLOSED_WON` got in;
 *  - `"WON"` and `"LOST"` always, so an org with no closed deals still does not
 *    treat those stages as open.
 */
export function resolveStageVocabulary(
  storedStages: Iterable<string>,
  wonStageNames: Iterable<string> = [],
  lostStageNames: Iterable<string> = [],
): StageVocabulary {
  const won = new Set<string>(["WON", ...wonStageNames])
  const lost = new Set<string>(["LOST", ...lostStageNames])
  for (const stage of storedStages) {
    const canonical = canonicalDealStage(stage, wonStageNames, lostStageNames)
    if (canonical === "WON") won.add(stage)
    else if (canonical === "LOST") lost.add(stage)
  }
  const wonStages = Array.from(won)
  const lostStages = Array.from(lost)
  return { wonStages, lostStages, closedStages: [...wonStages, ...lostStages] }
}
