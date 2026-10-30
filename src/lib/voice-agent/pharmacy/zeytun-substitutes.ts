/**
 * Substitutes on the phone line. Owner, 2026-10-26, of a product missing from
 * Zeytun's catalog: offer one with the same active substance, «та же доза и
 * та же форма». The substance is 1C's own field (Международные
 * фармакологические наименования), the form is 1C's item kind
 * (ВидНоменклатуры), the strength is read from the item's name. The agent
 * names the substance; nothing here trusts it beyond an exact match.
 */

/** The agent's request: `substitute: INN; strength; form`. The form is left
 * out when the caller named none: then every form of that strength, each
 * named to the caller, who chooses. */
export type SubstituteRequest = { inn: string; strength: Strength; form: string | null }
export type Strength = { amount: number; unit: "mg" | "mcg" | "ml" | "%" | "iu" }

export const SUBSTITUTE_PREFIX = /^\s*substitute\s*:/iu

/** "ACETYLCYSTEINE", "acetylcysteine", "Acetyl-cysteine" all read the same; other scripts do not match. */
export function innKey(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9+]/gu, "")
}

const UNITS: Array<[RegExp, Strength["unit"], number]> = [
  [/^(mkq|mcg|мкг|µg|μg)$/iu, "mcg", 1],
  [/^(mg|mq|мг)$/iu, "mg", 1],
  [/^(g|q|г|гр|gr)$/iu, "mg", 1000],
  [/^(ml|мл)$/iu, "ml", 1],
  [/^%$/u, "%", 1],
  [/^(iu|me|ме|bv|ед)$/iu, "iu", 1],
]
const STRENGTH = /(\d+(?:[.,]\d+)?)\s*(mkq|mcg|мкг|µg|μg|mg|mq|мг|gr|гр|g|q|г|ml|мл|%|iu|me|ме|bv|ед)(?![\p{L}])/iu

/** The first strength in a text: "А,Ц,Ц лонг 600 мг № 10" → 600 mg; grams become milligrams. */
export function strengthOf(text: string): Strength | null {
  const match = text.match(STRENGTH)
  if (!match) return null
  const amount = Number(match[1].replace(",", "."))
  const unit = UNITS.find(([pattern]) => pattern.test(match[2]))
  if (!unit || !Number.isFinite(amount) || amount <= 0) return null
  return { amount: Math.round(amount * unit[2] * 1000) / 1000, unit: unit[1] }
}

export function sameStrength(a: Strength, b: Strength) {
  return a.unit === b.unit && a.amount === b.amount
}

// One form under every name it goes by: 1C's item kinds and what an agent
// says in Azerbaijani, Russian or English. Order matters: the specific form
// before the general one (effervescent before tablet, eye drops before drops).
const FORMS: Array<[string, RegExp]> = [
  ["effervescent", /шипуч|effervesc|fışıldayan|fisildayan|suda həll|köpüklü/iu],
  ["chewable", /жеват|chewab|çeynə/iu],
  ["vaginal-suppository", /ваг.*(свеч|суп)|(свеч|суп).*ваг|vagin.*(suppos|şam)|vaginal şam/iu],
  ["vaginal-tablet", /ваг.*таб|vagin.*tab/iu],
  ["vaginal-capsule", /ваг.*капс|vagin.*caps|vagin.*kapsul/iu],
  ["suppository", /свеч|суппоз|suppos|şam\b/iu],
  ["eye-drops", /глаз.*кап|eye drop|göz damcı/iu],
  ["ear-drops", /уш.*кап|ear drop|qulaq damcı/iu],
  ["nasal-drops", /(назал|nasal).*(кап|drop)|кап.*назал|burun damcı/iu],
  ["nasal-spray", /(назал|nasal).*(спрей|spray)|burun sprey/iu],
  ["throat-spray", /спрей для горла|throat spray|boğaz sprey/iu],
  ["eye-ointment", /мазь глаз|глаз.*мазь|eye ointment|göz məlhəm/iu],
  ["eye-gel", /глаз.*гель|гель глаз|eye gel|göz gel/iu],
  ["infusion", /инфуз|infus/iu],
  ["syringe-pen", /шприц-ручк|syringe pen|pen injector/iu],
  ["ampoule", /ампул|ampul|ampoule|injection|inyeksiya|iynə/iu],
  ["softgel", /софт гель|soft ?gel/iu],
  ["capsule", /капсул|capsul|kapsul/iu],
  ["tablet", /таблет|tablet|həb|drajé|драже/iu],
  ["sachet", /саше|sachet|saşe/iu],
  ["granules", /гранул|granul/iu],
  ["powder", /порош|powder|toz\b/iu],
  ["pediatric-syrup", /сироп педиатр|pediatric syrup|uşaq sirop/iu],
  ["syrup", /сироп|syrup|sirop/iu],
  ["suspension", /суспенз|suspens|suspenziya/iu],
  ["drops", /капли|drops|damcı/iu],
  ["spray", /спрей|spray|sprey/iu],
  ["ointment", /мазь|ointment|məlhəm/iu],
  ["cream", /крем|cream|krem/iu],
  ["gel", /гель|\bgel/iu],
  ["solution", /раствор|solution|məhlul/iu],
  ["vial", /флакон|vial|flakon/iu],
  ["lozenge", /пастил|леденц|lozeng|pastil/iu],
  ["patch", /пластыр|patch|plastır/iu],
]

/** A form's key, or null when it is none of the known ones (then nothing is the same form). */
export function formKey(text: string): string | null {
  return FORMS.find(([, pattern]) => pattern.test(text))?.[0] ?? null
}

/** `substitute: ACETYLCYSTEINE; 600 mg; effervescent tablet` → its parts, or
 * null when the substance or strength is missing, or a form is given that is
 * none of the known ones (an unknown form must not widen to every form). */
export function parseSubstituteRequest(text: string): SubstituteRequest | null {
  if (!SUBSTITUTE_PREFIX.test(text)) return null
  const [inn, strength, form] = text.replace(SUBSTITUTE_PREFIX, "").split(";").map(part => part.trim())
  const parsed = strength ? strengthOf(strength) : null
  if (!inn || !innKey(inn) || !parsed) return null
  if (form && !formKey(form)) return null
  return { inn: innKey(inn), strength: parsed, form: form ? formKey(form) : null }
}
