import { normalizePharmacyLabel } from "./contracts"

function trigrams(text: string): Set<string> {
  const characters = Array.from(`  ${text} `)
  const result = new Set<string>()
  for (let i = 0; i + 2 < characters.length; i++) result.add(characters.slice(i, i + 3).join(""))
  return result
}

function dice(left: Set<string>, right: Set<string>): number {
  let shared = 0
  for (const gram of left) if (right.has(gram)) shared++
  return 2 * shared / (left.size + right.size)
}

/** Levenshtein distance, or limit + 1 as soon as it is certainly above limit. */
function editDistance(left: string[], right: string[], limit: number): number {
  if (Math.abs(left.length - right.length) > limit) return limit + 1
  let previous = Array.from({ length: right.length + 1 }, (_, i) => i)
  for (let i = 1; i <= left.length; i++) {
    const current = [i]
    let best = i
    for (let j = 1; j <= right.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1))
      best = Math.min(best, current[j])
    }
    if (best > limit) return limit + 1
    previous = current
  }
  return previous[right.length]
}

// Recognizers write the same sound with different letters: "Moshpa" and
// "Noşpa", "Ketenal", "Ushag" and "uşaq". Spelling slack is measured on this
// folded form, where Azerbaijani letters and their digraphs are one letter.
function foldSpelling(word: string): string[] {
  return Array.from(word.replace(/sh/gu, "ş").replace(/ch/gu, "ç").replace(/gh/gu, "ğ")
    .replace(/[şç]/gu, (ch) => (ch === "ş" ? "s" : "c")).replace(/ğ/gu, "g").replace(/ı/gu, "i")
    .replace(/ö/gu, "o").replace(/ü/gu, "u").replace(/ə/gu, "e"))
}

// Spoken names arrive through speech recognition: "Ketanol" for Ketonal,
// "Noşpa" for No-şpa. Short words get no slack, they collide too easily.
function spellingSlack(length: number): number {
  return length >= 7 ? 2 : length >= 5 ? 1 : 0
}

/** Candidate discovery only. Owners must check tenant scope before calling. */
export class PharmacyNameSearch {
  private readonly terms = new Map<string, Set<string>>()
  private readonly postings = new Map<string, Set<string>>()
  private readonly sizes = new Map<string, number>()
  private readonly words = new Map<string, { grams: Set<string>; letters: string[]; folded: string[] }>()
  private readonly ids = new Set<string>()
  private readonly fullLabels = new Set<string>()

  constructor(private readonly indexWords = false) {}

  add(id: string, rawName: string): void {
    const name = normalizePharmacyLabel(rawName)
    this.ids.add(id)
    this.fullLabels.add(name)
    const labels = new Set([name])
    if (this.indexWords) {
      // Full feed names contain dose, brand and packaging in one long label.
      // Word entries improve discovery; they NEVER become approved aliases.
      for (const word of pharmacyWords(name)) {
        labels.add(word)
        if (!this.words.has(word)) this.words.set(word, { grams: trigrams(word), letters: Array.from(word), folded: foldSpelling(word) })
      }
    }
    for (const label of labels) {
      const existing = this.terms.get(label)
      if (existing) {
        existing.add(id)
        continue
      }
      this.terms.set(label, new Set([id]))
      const grams = trigrams(label)
      this.sizes.set(label, grams.size)
      for (const gram of grams) {
        const terms = this.postings.get(gram) ?? new Set<string>()
        terms.add(label)
        this.postings.set(gram, terms)
      }
    }
  }

  find(rawName: string): string[] {
    const name = normalizePharmacyLabel(rawName)
    if (Array.from(name).length < 3) return [...(this.terms.get(name) ?? [])]
    const [whole, full] = this.scoreWhole(name)
    if (!this.indexWords) return rank(whole, new Map(), new Map())
    // A spoken request is "No-şpa ampula": scored only as one string, the
    // form word matches every ampoule in the feed as well as the name does,
    // and the medicine itself falls out of the five candidates returned.
    // Rank by how many of the caller's words an item matches first, each word
    // weighted by how rare it is in the feed: "noşpa" names three items,
    // "ampula" two hundred and "qutu" thousands.
    const covered = new Map<string, number>()
    for (const word of new Set(pharmacyWords(name))) {
      if (QUANTITY_WORDS.has(word)) continue
      const matches = this.matchWord(word)
      if (!matches.size) continue
      // The word's weight comes from its closest spelling, so a rarer but
      // more distant word (Retinol for "ketanol") cannot outrank Ketonal.
      const [closest] = [...matches].sort(([a, left], [b, right]) => right - left || a.localeCompare(b))[0]
      const weight = Math.log(1 + this.ids.size / this.terms.get(closest)!.size)
      const best = new Map<string, number>()
      for (const [label, score] of matches) {
        for (const id of this.terms.get(label)!) best.set(id, Math.max(best.get(id) ?? 0, score * weight))
      }
      for (const [id, score] of best) covered.set(id, (covered.get(id) ?? 0) + score)
    }
    return rank(whole, covered, full)
  }

  private matchWord(word: string): Map<string, number> {
    const grams = trigrams(word), letters = Array.from(word), folded = foldSpelling(word)
    const slack = spellingSlack(folded.length)
    const result = new Map<string, number>()
    for (const [label, entry] of this.words) {
      let score = dice(grams, entry.grams)
      const limit = Math.min(slack, spellingSlack(entry.folded.length))
      if (score < 0.5) {
        const distance = editDistance(folded, entry.folded, limit)
        if (distance <= limit) score = Math.max(score, 1 - distance / Math.max(folded.length, entry.folded.length))
      }
      if (score < 0.5) continue
      // Between equally close spellings prefer the shared beginning and the
      // spoken length: "ketanol" is Ketonal before Retinol or Ketan (flax oil).
      let prefix = 0
      while (prefix < 4 && letters[prefix] !== undefined && letters[prefix] === entry.letters[prefix]) prefix++
      result.set(label, score + 0.03 * prefix - 0.03 * Math.abs(letters.length - entry.letters.length))
    }
    return result
  }

  /** Best score over any label, and over complete product names only: two
   * items matching the same words are told apart by the whole request. */
  private scoreWhole(name: string): [Map<string, number>, Map<string, number>] {
    const grams = trigrams(name)
    const counts = new Map<string, number>()
    for (const gram of grams) {
      for (const term of this.postings.get(gram) ?? []) counts.set(term, (counts.get(term) ?? 0) + 1)
    }
    const scores = new Map<string, number>(), full = new Map<string, number>()
    for (const [term, count] of counts) {
      // Presentation ranking only, never a confidence/identity/approval gate.
      const score = 2 * count / (grams.size + this.sizes.get(term)!)
      if (this.indexWords && this.fullLabels.has(term)) {
        for (const id of this.terms.get(term)!) full.set(id, Math.max(full.get(id) ?? 0, score))
      }
      if (score < 0.3) continue
      for (const id of this.terms.get(term)!) scores.set(id, Math.max(scores.get(id) ?? 0, score))
    }
    return [scores, full]
  }
}

// How much and how many, not which product. Spoken requests often carry them
// ("No-şpa ampula beş qutu"); matched, they rank any boxed item above the
// medicine. Packaging forms (ampula, şam, ...) stay: they tell products apart.
const QUANTITY_WORDS = new Set([
  "qutu", "qutusu", "qutudan", "ədəd", "dənə", "paket", "bir", "iki", "üç", "dörd", "beş", "altı", "yeddi",
  "səkkiz", "doqquz", "iyirmi", "otuz", "qırx", "əlli", "altmış", "yetmiş", "səksən", "doxsan", "yüz", "min",
  "lazımdır", "istəyirəm", "yazın", "olsun",
])

/** Letter words of a normalized label, with hyphenated names also joined:
 * the feed writes "No-şpa", a recognizer hears "Noşpa". */
function pharmacyWords(name: string): string[] {
  const result: string[] = []
  for (const word of name.match(/[\p{L}\p{M}]+/gu) ?? []) {
    if (Array.from(word).length >= 3) result.push(word)
  }
  for (const joined of name.match(/[\p{L}\p{M}]+(?:-[\p{L}\p{M}]+)+/gu) ?? []) result.push(joined.replace(/-/gu, ""))
  return result
}

function rank(whole: Map<string, number>, covered: Map<string, number>, full: Map<string, number>): string[] {
  const ids = new Set([...whole.keys(), ...covered.keys()])
  const by = (scores: Map<string, number>, a: string, b: string) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0)
  return [...ids].sort((a, b) => by(covered, a, b) || by(full, a, b) || by(whole, a, b) || a.localeCompare(b))
}
