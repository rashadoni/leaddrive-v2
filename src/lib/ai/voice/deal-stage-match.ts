/**
 * Which stage the user meant, among the stages THIS deal's pipeline actually
 * has (roadmap V1.2c).
 *
 * `Deal.stage` is a free string and pipelines are configured per organisation —
 * production holds seven spellings of five stages. So the destination is never
 * invented here: it is one of the `PipelineStage` rows of the deal's own
 * pipeline, and `isWon`/`isLost` come from that row rather than from guessing at
 * the word.
 *
 * The bridge that is needed is linguistic, not semantic. The stages are stored
 * with English names ("NEGOTIATION"), and the user says "переговоры" or
 * "danışıqlar". SYNONYMS maps spoken words onto the canonical English key, and
 * the key is then matched against what the organisation has configured — an org
 * that renamed its stages keeps its own names, and a stage that does not exist
 * in the pipeline cannot be selected by any wording.
 */

export type PipelineStageOption = Readonly<{
  name: string
  displayName: string
  isWon: boolean
  isLost: boolean
}>

export type DealStageMatch =
  | Readonly<{ ok: true; stage: PipelineStageOption }>
  | Readonly<{ ok: false; ambiguous: boolean; options: readonly PipelineStageOption[] }>

/** Spoken words → the canonical stage key they name, in the three languages. */
const SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  lead: ["lead", "лид", "новый", "новая", "lid", "yeni"],
  qualified: ["qualified", "квалифицирован", "квалификация", "kvalifikasiya"],
  proposal: ["proposal", "предложение", "коммерческое", "оферта", "təklif", "teklif"],
  negotiation: ["negotiation", "переговоры", "переговорах", "торг", "danışıq", "danisiq", "danışıqlar"],
  won: ["won", "выиграна", "выиграли", "выигранная", "закрыта успешно", "успешно", "udulmuş", "qazanıldı", "qazanildi"],
  lost: ["lost", "проиграна", "проиграли", "провалена", "отказ", "uduzdu", "itirildi", "imtina"],
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ə/g, "e")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

/** The canonical keys a spoken phrase names, if any. */
function canonicalKeys(spoken: string): string[] {
  const text = normalize(spoken)
  if (!text) return []
  return Object.entries(SYNONYMS)
    .filter(([, words]) => words.some((word) => {
      const term = normalize(word)
      return term.length >= 3 && (text === term || text.includes(term))
    }))
    .map(([key]) => key)
}

/**
 * Match what the user said against the configured stages.
 *
 * Order matters: an organisation's own spelling wins over the built-in
 * synonyms, so renaming a stage to "Переговоры" keeps working and never
 * resolves through the English key it no longer uses.
 */
export function matchDealStage(
  spoken: string,
  stages: readonly PipelineStageOption[],
): DealStageMatch {
  if (stages.length === 0) return { ok: false, ambiguous: false, options: [] }
  const text = normalize(spoken)
  if (!text) return { ok: false, ambiguous: false, options: stages }

  const exact = stages.filter((stage) => (
    normalize(stage.name) === text || normalize(stage.displayName) === text
  ))
  if (exact.length === 1) return { ok: true, stage: exact[0] }

  const partial = stages.filter((stage) => {
    const name = normalize(stage.name)
    const display = normalize(stage.displayName)
    return (name.length >= 3 && (text.includes(name) || name.includes(text)))
      || (display.length >= 3 && (text.includes(display) || display.includes(text)))
  })
  if (partial.length === 1) return { ok: true, stage: partial[0] }

  // Each stage's OWN keys, so a pipeline renamed into Azerbaijani still answers
  // to the Russian word for the same thing — and a stage whose name means
  // nothing in any of the three languages simply has no keys and is never
  // selected by a synonym.
  const keysOf = (stage: PipelineStageOption): string[] => {
    const keys = new Set([...canonicalKeys(stage.name), ...canonicalKeys(stage.displayName)])
    // A renamed won/lost stage is still the won/lost stage of that pipeline.
    if (stage.isWon) keys.add("won")
    if (stage.isLost) keys.add("lost")
    return [...keys]
  }
  const keys = canonicalKeys(spoken)
  if (keys.length > 0) {
    const viaSynonym = stages.filter((stage) => keysOf(stage).some((key) => keys.includes(key)))
    if (viaSynonym.length === 1) return { ok: true, stage: viaSynonym[0] }
    if (viaSynonym.length > 1) return { ok: false, ambiguous: true, options: viaSynonym }
  }

  return { ok: false, ambiguous: partial.length > 1, options: partial.length > 1 ? partial : stages }
}
