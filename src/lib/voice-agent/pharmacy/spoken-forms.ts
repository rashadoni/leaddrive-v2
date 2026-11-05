/**
 * Form and strength words of a spoken request, for the phone line's name
 * search (name-search.ts). A pharmacy names a product as "brand + form (+
 * strength)": "Parasetamol şam 50", "Ketonal ampula". Matched as one more
 * word, the form word pulled other brands: "tablet" is a rare word in 1C's
 * names (a few НаименованиеАз say "fışıldayan tablet"), so "Diklofenak tablet"
 * came back as two effervescent ACC first. Measured on Zeytun's whole catalog
 * (scripts/zeytun-line/search-benchmark.ts --forms, 2026-11-05): the asked
 * form came first in 69.7% of "brand + form", "tablet" 22.9%, "paket" 17.4%.
 * Now the form only chooses among the brand's own variants.
 *
 * The words are 1C's own: every item's name carries its kind in Russian
 * ("(Таблетки)", "(Свечи)") and two of five НаименованиеАз the Azerbaijani
 * one ("(Həb)", "(Şam)", "(Damcı)", "(Şərbət)", "(Saşe)"), snapshot
 * 2026-11-04; plus what callers say instead ("tablet", "sirop", "paket").
 */
import { formKey } from "./zeytun-substitutes"

/** Kinds formKey (zeytun-substitutes.ts) does not read: 1C's "Пакет" is a sachet. */
const KIND_FORMS: Record<string, string> = {
  "пакет": "sachet", "масло": "oil", "шампунь": "shampoo", "мыло": "soap", "аэрозоль": "spray",
}

/** An item's form from 1C's item kind (ВидНоменклатуры), or null. */
export function itemFormOfKind(kind: string): string | null {
  return formKey(kind) ?? KIND_FORMS[kind.trim().toLowerCase()] ?? null
}

/**
 * A form's family: a caller who says "tablet" may mean the brand's
 * effervescent tablets when it has no plain ones, "damcı" its eye drops.
 * The asked form itself counts twice as much as one of its family.
 */
const FAMILY: Record<string, string> = {
  effervescent: "tablet", chewable: "tablet", "vaginal-tablet": "tablet",
  softgel: "capsule", "vaginal-capsule": "capsule",
  "vaginal-suppository": "suppository",
  "eye-drops": "drops", "ear-drops": "drops", "nasal-drops": "drops",
  "nasal-spray": "spray", "throat-spray": "spray",
  "eye-ointment": "ointment", "eye-gel": "gel",
  "pediatric-syrup": "syrup",
  sachet: "powder", granules: "powder",
}
const family = (form: string) => FAMILY[form] ?? form

// Every word is compared folded (name-search.ts foldSpelling: ş→s, ç→c, ə→e,
// ı→i, ü→u, q→g, Cyrillic to Latin), with the Azerbaijani endings below.
const FORM_WORDS: Record<string, string[]> = {
  tablet: ["həb", "tablet", "tabletka", "таблетка", "таблетки", "draje", "драже"],
  effervescent: ["fışıldayan", "fışıldıyan", "шипучие", "шипучая"],
  chewable: ["çeynəmə", "жевательные", "жевательная"],
  capsule: ["kapsul", "kapsula", "капсула", "капсулы"],
  ampoule: ["ampula", "ampul", "ампула", "ампулы", "iynə", "inyeksiya", "ukol"],
  suppository: ["şam", "свеча", "свечи", "suppozitoriya", "supozitoriya", "суппозитории"],
  drops: ["damcı", "damla", "капли"],
  syrup: ["şərbət", "sirop", "şurup", "сироп"],
  suspension: ["suspenziya", "суспензия"],
  powder: ["toz", "poroşok", "порошок"],
  granules: ["granula", "qranula", "гранулы"],
  sachet: ["saşe", "paket", "paketik", "саше", "пакет", "пакетик"],
  cream: ["krem", "крем"],
  gel: ["gel", "гель", "emulgel"],
  ointment: ["məlhəm", "мазь"],
  spray: ["sprey", "spray", "спрей", "aerozol", "aerazol", "аэрозоль"],
  solution: ["məhlul", "раствор"],
  vial: ["flakon", "флакон"],
  infusion: ["infuziya", "инфузия"],
  lozenge: ["pastilka", "pastil", "пастилки", "леденцы"],
  patch: ["plastır", "plastr", "leykoplastr", "пластырь"],
  oil: ["yağ", "масло"],
  shampoo: ["şampun", "шампунь"],
  soap: ["sabun", "мыло"],
}
/** Words that narrow a form: "göz damcısı" is eye drops, "burun spreyi" a nasal spray. */
const KIND_WORDS: Record<string, string[]> = {
  "eye-": ["göz", "глазные", "глазная"],
  "ear-": ["qulaq", "ушные"],
  "nasal-": ["burun", "назальный", "назальные"],
  "throat-": ["boğaz"],
  "vaginal-": ["vaginal", "vaqinal", "вагинальные", "вагинальная"],
  "pediatric-": ["pediatrik", "педиатрический"],
}
// "damcısı", "şamlar", "kremi", "həbləri": the stem with an Azerbaijani ending.
const ENDINGS = ["", "i", "u", "si", "su", "lar", "ler", "lari", "leri", "nin"]

export interface SpokenForms {
  /** Forms the request names (none when it names none). */
  forms: string[]
  /** Prefixes of the forms the request narrows to ("eye-"). */
  kinds: string[]
  /** Numbers the request gives as a strength ("50", "500 mq"), in 1C's units as written and in mg. */
  strengths: number[]
}

/** foldSpelling of name-search.ts, passed in so both read words the same way. */
export type Fold = (word: string) => string

export function createSpokenForms(fold: Fold) {
  const forms = new Map<string, string>(), kinds = new Map<string, string>()
  for (const [form, words] of Object.entries(FORM_WORDS)) {
    for (const word of words) for (const ending of ENDINGS) forms.set(fold(word) + ending, form)
  }
  for (const [kind, words] of Object.entries(KIND_WORDS)) {
    for (const word of words) for (const ending of ENDINGS) kinds.set(fold(word) + ending, kind)
  }
  return {
    /** The form a single word names, or null. */
    formOf(word: string): string | null {
      return forms.get(fold(word)) ?? null
    },
    kindOf(word: string): string | null {
      return kinds.get(fold(word)) ?? null
    },
    /**
     * The form 1C wrote into a label, from its first bracketed group that
     * names one: "(Şam)", "(göz damcısı)", "(fışıldayan tablet)". For items
     * added without their kind; the narrower form wins.
     */
    labelForm(label: string): string | null {
      for (const [, group] of label.matchAll(/\(([^()]*)\)/gu)) {
        const words = group.match(/[\p{L}\p{M}]+/gu) ?? []
        const named = words.map((word) => forms.get(fold(word))).filter((form): form is string => Boolean(form))
        if (!named.length) continue
        const form = named.find((candidate) => family(candidate) !== candidate) ?? named[0]
        const kind = words.map((word) => kinds.get(fold(word))).find(Boolean)
        return kind && FAMILY[kind + form] ? kind + form : form
      }
      return null
    },
  }
}

/**
 * How well an item's form answers the request: 2 for the form asked, 1 for
 * its family, plus 1 for each narrowing word it fits ("göz" and eye drops).
 */
export function formScore(itemForm: string | null, spoken: SpokenForms): number {
  if (!itemForm) return 0
  let score = 0
  for (const form of spoken.forms) score += itemForm === form ? 2 : family(itemForm) === family(form) ? 1 : 0
  for (const kind of spoken.kinds) if (itemForm.startsWith(kind)) score++
  return score
}

const GRAMS = /^(g|q|qr|gr|г|гр)$/iu
const UNIT = "mkq|mcg|мкг|mg|mq|мг|qr|gr|гр|g|q|г|ml|мл|%|me|ме|ед|iu|vah|tv"
const ITEM_STRENGTH = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(${UNIT})(?![\\p{L}])`, "giu")

function amounts(value: string, unit: string | undefined): number[] {
  const amount = Number(value.replace(",", "."))
  if (!Number.isFinite(amount) || amount <= 0) return []
  return unit && GRAMS.test(unit) ? [amount, Math.round(amount * 1000 * 1000) / 1000] : [amount]
}

/** Strengths written in an item's label: "0,5 гр" is 0.5 and 500, "100 мг/ 2 мл" is 100 and 2. */
export function itemStrengths(label: string): number[] {
  return [...label.matchAll(ITEM_STRENGTH)].flatMap((match) => amounts(match[1], match[2]))
}

/**
 * Strengths a request gives: a number, with or without its unit, that is not
 * a pack ("№ 20") or a count ("10 qutu", "on qutu" never reaches here as a
 * number). `quantity`: whether a word is a count word (name-search.ts).
 */
export function spokenStrengths(text: string, quantity: (word: string) => boolean): number[] {
  const result: number[] = []
  const pattern = new RegExp(`(№\\s*)?(\\d+(?:[.,]\\d+)?)(?:\\s*(${UNIT})(?![\\p{L}]))?(?:\\s+([\\p{L}]+))?`, "giu")
  for (const match of text.matchAll(pattern)) {
    if (match[1]) continue
    if (!match[3] && match[4] && quantity(match[4])) continue
    result.push(...amounts(match[2], match[3]))
  }
  return result
}
