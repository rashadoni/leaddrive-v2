import { normalizePharmacyLabel } from "./contracts"
import { createSpokenForms, formScore, itemStrengths, spokenStrengths, type SpokenForms } from "./spoken-forms"

function trigrams(text: string): Set<string> {
  const characters = Array.from(`  ${text} `)
  const result = new Set<string>()
  for (let i = 0; i + 2 < characters.length; i++) result.add(characters[i] + characters[i + 1] + characters[i + 2])
  return result
}

// Two rows of the distance table, reused: thousands of words are measured per spoken word.
let rows = [new Int32Array(64), new Int32Array(64)]

/**
 * Edit distance in half letters, or limit + 1 as soon as it is certainly above
 * limit: a letter swapped for one that sounds alike (SOUND_CLASS) costs 1, any
 * other edit 2.
 */
function editDistance(left: Int32Array, right: Int32Array, limit: number): number {
  if (2 * Math.abs(left.length - right.length) > limit) return limit + 1
  if (rows[0].length <= right.length) rows = [new Int32Array(right.length + 1), new Int32Array(right.length + 1)]
  let [previous, current] = rows
  for (let j = 0; j <= right.length; j++) previous[j] = 2 * j
  for (let i = 1; i <= left.length; i++) {
    current[0] = 2 * i
    let best = 2 * i
    for (let j = 1; j <= right.length; j++) {
      const a = left[i - 1], b = right[j - 1]
      const swap = a === b ? 0 : soundClass(a) === soundClass(b) ? 1 : 2
      current[j] = Math.min(previous[j] + 2, current[j - 1] + 2, previous[j - 1] + swap)
      if (current[j] < best) best = current[j]
    }
    if (best > limit) return limit + 1
    const done = previous
    previous = current
    current = done
  }
  return previous[right.length]
}

/** One number per letter of a folded spelling: compared like the letters, without strings. */
function letterCodes(letters: string[]): Int32Array {
  return Int32Array.from(letters, (letter) => letter.codePointAt(0)!)
}

/**
 * Which sounds a word has, a bit per SOUND_CLASS (others may share a bit): a
 * swap within a class leaves the bits alone, so lettersApart still bounds the
 * distance from below.
 */
function letterBits(codes: Int32Array): number {
  let bits = 0
  for (const code of codes) bits |= 1 << (soundClass(code) & 31)
  return bits
}

function bitCount(bits: number): number {
  bits -= (bits >>> 1) & 0x55555555
  bits = (bits & 0x33333333) + ((bits >>> 2) & 0x33333333)
  return Math.imul((bits + (bits >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24
}

/**
 * Every sound one word has and the other lacks costs a whole edit (2), and an
 * edit settles at most one such sound on each side: a lower bound on the
 * distance in whole edits, far cheaper than computing it.
 */
function lettersApart(left: number, right: number): number {
  return Math.max(bitCount(left & ~right), bitCount(right & ~left))
}

// Two of three Zeytun feed names exist only in Cyrillic ("Адефа № 30"), while
// the caller's words arrive in Azerbaijani Latin ("Adefa"); live call
// 2026-10-28 found nothing. Folded, both scripts are the same letters.
const CYRILLIC_LATIN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "o", ж: "j", з: "z", и: "i", й: "y", к: "k", л: "l",
  м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "s", ч: "ç", ш: "ş",
  щ: "ş", ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya",
}

// Recognizers write the same sound with different letters: "Moshpa" and
// "Noşpa", "Ketenal", "Ushag" and "uşaq". Spelling slack is measured on this
// folded form, where Azerbaijani letters and their digraphs are one letter.
// Azerbaijani writes Russian «г» as "q" ("Aqemo" for Агемо): one letter here.
function foldSpelling(word: string): string[] {
  const latin = word.replace(/дж/gu, "c").replace(/[а-яё]/gu, (ch) => CYRILLIC_LATIN[ch] ?? ch).replace(/dj/gu, "c")
  return Array.from(latin.replace(/sh/gu, "ş").replace(/ch/gu, "ç").replace(/gh/gu, "ğ")
    .replace(/[şç]/gu, (ch) => (ch === "ş" ? "s" : "c")).replace(/[ğq]/gu, "g").replace(/ı/gu, "i")
    .replace(/ö/gu, "o").replace(/ü/gu, "u").replace(/ə/gu, "e"))
}

// Sounds a phone line and a recognizer swap for each other, in Azerbaijani and
// Russian: voiced and voiceless pairs, k/g, f/x/h, l/r, m/n and the vowels.
// Owner's calls: "Adexa" for Adefa, "Azirak" for Azirag, "Aceticold" for
// Аджиколд. Measured on Zeytun's whole feed (4792 names, 2026-11-03) rather
// than case by case — scripts/zeytun-line/search-benchmark.ts.
// A table, not a Map: it is read for every cell of every distance computed.
const SOUND_CLASS = new Int32Array(0x250).map((_, code) => code)
for (const group of ["kg", "dt", "bp", "vfxh", "sz", "cj", "lr", "mn", "ae", "ou", "iy"]) {
  for (const letter of group) SOUND_CLASS[letter.codePointAt(0)!] = group.codePointAt(0)!
}
function soundClass(code: number): number {
  return code < SOUND_CLASS.length ? SOUND_CLASS[code] : code
}

function soundKey(codes: Int32Array): string {
  return String.fromCodePoint(...Array.from(codes, soundClass))
}

// Spoken names arrive through speech recognition: "Ketanol" for Ketonal,
// "Noşpa" for No-şpa. Half letters (editDistance): short words get at most one
// alike sound, three-letter words none — they collide too easily.
function spellingSlack(length: number): number {
  return length >= 7 ? 4 : length >= 5 ? 2 : length === 4 ? 1 : 0
}

/** Words shorter than this, folded, are found by their spelling or sounds, not scanned by length. */
const SLACK_FROM = 5
/**
 * How much a caller's word counts when it matches only an item's maker or
 * country. 2026-11-03 owner's call: "Abdi İbrahim Adefa" — two maker words
 * outweighed the one product name, and the five candidates were Abdi Ibrahim
 * items without Adefa. A maker word still decides between two equal names
 * ("Parasetamol Sopharma"), never against a name.
 */
const SOURCE_WORD_WEIGHT = 0.25

interface IndexedWord { label: string; gramCount: number; letters: string[]; folded: Int32Array; foldedKey: string }

/** One item of a ranked search: its scores in sort order, and how many of the request's words it has exactly. */
export interface RankedItem { id: string; covered: number; full: number; whole: number; exact: number; words: number }

/**
 * Candidate discovery only. Owners must check tenant scope before calling.
 *
 * Labels, words and items are numbered in the order they were first added,
 * and every pass below visits them in that order, so ties are broken exactly
 * as by a scan of the whole index. 2026-10-28 on prod (9 176 items, 13 430
 * words) that scan held the web process 0.1-0.9 s per spoken request; the
 * station's call waits on the same thread.
 */
export class PharmacyNameSearch {
  private readonly terms = new Map<string, number>()
  private readonly termIds: Set<number>[] = []
  private readonly termSizes: number[] = []
  /** Whether the label is some item's complete name, not only one of its words. */
  private readonly termIsName: boolean[] = []
  /** Per word label: items in whose labels this word is only the maker or country. */
  private readonly sourceOnly = new Map<number, Set<number>>()
  private readonly postings = new Map<string, number[]>()
  private readonly words = new Map<string, number>()
  private readonly wordList: IndexedWord[] = []
  private readonly wordPostings = new Map<string, number[]>()
  /** Folded spelling → words, for words too short for slack. */
  private readonly shortFolded = new Map<string, number[]>()
  /** Sounds (SOUND_CLASS) → short words: one alike sound away is the same key. */
  private readonly shortSounds = new Map<string, number[]>()
  /** Folded length → words with slack, and which letters each has: slack k reaches only lengths within k. */
  private readonly byFoldedLength: number[][] = []
  private readonly bitsByFoldedLength: number[][] = []
  private readonly idIndex = new Map<string, number>()
  private readonly idList: string[] = []
  /** Per item: its form (spoken-forms.ts) and the strengths its labels write. */
  private readonly itemForms: (string | null)[] = []
  private readonly formGiven: boolean[] = []
  private readonly itemAmounts: Set<number>[] = []
  // Per-call scratch, cleared after each use.
  private termCounts = new Int32Array(0)
  private wordCounts = new Int32Array(0)
  private wordScores = new Float64Array(0)
  private wholeScores = new Float64Array(0)
  private fullScores = new Float64Array(0)
  private coveredScores = new Float64Array(0)
  private bestScores = new Float64Array(0)
  private coveredSeen = new Uint8Array(0)
  private bestSeen = new Uint8Array(0)
  private bestLabels = new Int32Array(0)

  constructor(private readonly indexWords = false) {}

  /**
   * `source`: the parts of the label that name the maker and country, not the product.
   * `form`: the item's form from 1C's item kind (spoken-forms.ts itemFormOfKind);
   * left out, it is read from the label's brackets ("(Şam)", "(Таблетки)").
   */
  add(id: string, rawName: string, source: string[] = [], form?: string | null): void {
    const name = normalizePharmacyLabel(rawName)
    let item = this.idIndex.get(id)
    if (item === undefined) {
      item = this.idList.push(id) - 1
      this.idIndex.set(id, item)
      this.itemForms.push(null)
      this.formGiven.push(false)
      this.itemAmounts.push(new Set())
    }
    if (form !== undefined) {
      if (!this.formGiven[item]) this.itemForms[item] = form
      this.formGiven[item] = true
    } else if (!this.formGiven[item] && this.itemForms[item] === null) this.itemForms[item] = SPOKEN.labelForm(name)
    for (const amount of itemStrengths(name)) this.itemAmounts[item].add(amount)
    const labels = new Set([name])
    let own: Set<string> | null = null
    if (this.indexWords && source.length) {
      let rest = rawName
      for (const part of source) rest = rest.replace(part, " ")
      own = new Set(pharmacyWords(normalizePharmacyLabel(rest)))
    }
    if (this.indexWords) {
      // Full feed names contain dose, brand and packaging in one long label.
      // Word entries improve discovery; they NEVER become approved aliases.
      for (const word of pharmacyWords(name)) {
        labels.add(word)
        if (!this.words.has(word)) this.addWord(word)
      }
    }
    for (const label of labels) {
      const fromSource = own !== null && label !== name && !own.has(label)
      const existing = this.terms.get(label)
      if (existing !== undefined) {
        const ids = this.termIds[existing], sources = this.sourceOnly.get(existing)
        // A word in the item's own name in any of its labels stays a name word.
        if (!fromSource) sources?.delete(item)
        else if (!ids.has(item)) this.sourceOnly.set(existing, (sources ?? new Set()).add(item))
        ids.add(item)
        if (label === name) this.termIsName[existing] = true
        continue
      }
      const term = this.termIds.push(new Set([item])) - 1
      if (fromSource) this.sourceOnly.set(term, new Set([item]))
      this.terms.set(label, term)
      this.termIsName.push(label === name)
      const grams = trigrams(label)
      this.termSizes.push(grams.size)
      // ~1 million postings for Zeytun's feed (2026-10-28: 26 692 labels): one
      // lookup per gram, not a lookup and a store.
      for (const gram of grams) {
        const terms = this.postings.get(gram)
        if (terms) terms.push(term)
        else this.postings.set(gram, [term])
      }
    }
  }

  private addWord(word: string): void {
    const index = this.wordList.length
    this.words.set(word, index)
    const grams = trigrams(word), letters = foldSpelling(word)
    const folded = letterCodes(letters)
    this.wordList.push({ label: word, gramCount: grams.size, letters: Array.from(word), folded, foldedKey: letters.join("") })
    for (const gram of grams) {
      const words = this.wordPostings.get(gram)
      if (words) words.push(index)
      else this.wordPostings.set(gram, [index])
    }
    if (letters.length < SLACK_FROM) {
      const key = letters.join(""), same = this.shortFolded.get(key)
      if (same) same.push(index)
      else this.shortFolded.set(key, [index])
      const sounds = soundKey(folded), alike = this.shortSounds.get(sounds)
      if (alike) alike.push(index)
      else this.shortSounds.set(sounds, [index])
    } else {
      const length = letters.length
      this.byFoldedLength[length] ??= []
      this.bitsByFoldedLength[length] ??= []
      this.byFoldedLength[length].push(index)
      this.bitsByFoldedLength[length].push(letterBits(folded))
    }
  }

  find(rawName: string): string[] {
    return this.rank(rawName).map((row) => row.id)
  }

  /**
   * The same ranking as find, with what each place rests on: `exact` — how
   * many of the request's product words the item has spelled exactly as
   * heard (folded), of `words`. An item with every word exact is what the
   * caller clearly said (pharmacy-assortment.ts never lifts anything above it).
   */
  rank(rawName: string): RankedItem[] {
    const name = normalizePharmacyLabel(rawName)
    if (Array.from(name).length < 3) {
      const term = this.terms.get(name)
      return term === undefined ? [] : [...this.termIds[term]].map((item) =>
        ({ id: this.idList[item], covered: 0, full: 0, whole: 1, exact: 0, words: 0 }))
    }
    this.fitItemScratch()
    const [whole, full] = this.scoreWhole(name)
    // "Parasetamol şam 50": the form and the strength choose among the
    // brand's own variants (spoken-forms.ts), they do not search by
    // themselves. With no other word left, a form word is the name.
    const said = this.indexWords ? [...new Set(pharmacyWords(name))] : []
    const forms = said.map((word) => SPOKEN.formOf(word)).filter((form): form is string => form !== null)
    const named = said.filter((word) => !QUANTITY_WORDS.has(word) && !SPOKEN.formOf(word) && !(forms.length && SPOKEN.kindOf(word)))
    let spoken: SpokenForms | null = null
    if (named.length) {
      spoken = { forms, kinds: forms.length ? said.map((word) => SPOKEN.kindOf(word)).filter((kind): kind is string => kind !== null) : [],
        strengths: spokenStrengths(name, (word) => QUANTITY_WORDS.has(word)) }
      if (!spoken.forms.length && !spoken.strengths.length) spoken = null
    }
    const productWords = named.length ? named : said.filter((word) => !QUANTITY_WORDS.has(word))
    const signatures = spoken ? new Map<number, string>() : null
    // A spoken request is "No-şpa ampula": scored only as one string, the
    // form word matches every ampoule in the feed as well as the name does,
    // and the medicine itself falls out of the five candidates returned.
    // Rank by how many of the caller's words an item matches first, each word
    // weighted by how rare it is in the feed: "noşpa" names three items,
    // "ampula" two hundred and "qutu" thousands.
    const covered: number[] = []
    const coveredScores = this.coveredScores, coveredSeen = this.coveredSeen, bestScores = this.bestScores, bestSeen = this.bestSeen
    const exact = new Map<number, number>()
    let words = 0
    const bestLabels = this.bestLabels
    for (const [position, word] of productWords.entries()) {
      words++
      const matches = this.matchWord(word)
      if (!matches.size) continue
      const said = foldSpelling(word).join("")
      for (const label of matches.keys()) {
        if (this.wordList[this.words.get(label)!].foldedKey !== said) continue
        for (const item of this.termIds[this.terms.get(label)!]) exact.set(item, (exact.get(item) ?? 0) + 1)
      }
      // The word's weight comes from its closest spelling, so a rarer but
      // more distant word (Retinol for "ketanol") cannot outrank Ketonal.
      let closest = "", closestScore = -Infinity
      for (const [label, score] of matches) {
        if (score > closestScore || (score === closestScore && label.localeCompare(closest) < 0)) [closest, closestScore] = [label, score]
      }
      const weight = Math.log(1 + this.idList.length / this.termIds[this.terms.get(closest)!].size)
      const best: number[] = []
      for (const [label, score] of matches) {
        // A maker's word wherever most of its labels put it there: 1C writes a
        // few labels out of pattern (three of Abdi Ibrahim's 57 on 2026-11-03).
        const term = this.terms.get(label)!, ids = this.termIds[term], labelIndex = this.words.get(label)!
        const factor = (this.sourceOnly.get(term)?.size ?? 0) * 2 > ids.size ? SOURCE_WORD_WEIGHT : 1
        for (const item of ids) {
          const value = score * weight * factor
          if (!bestSeen[item]) {
            bestSeen[item] = 1
            best.push(item)
            bestScores[item] = Math.max(0, value)
            bestLabels[item] = labelIndex
          } else if (value > bestScores[item]) {
            bestScores[item] = value
            bestLabels[item] = labelIndex
          }
        }
      }
      for (const item of best) {
        // Which brand an item is to this request: the catalog spelling each
        // of its words was heard as, folded ("Кетонал" and "Ketonal" are one).
        if (signatures) signatures.set(item, `${signatures.get(item) ?? ""}${position}:${this.wordList[bestLabels[item]].foldedKey} `)
        if (!coveredSeen[item]) {
          coveredSeen[item] = 1
          covered.push(item)
          coveredScores[item] = 0 + bestScores[item]
        } else coveredScores[item] += bestScores[item]
        bestSeen[item] = 0
        bestScores[item] = 0
      }
    }
    const wholeScores = this.wholeScores, fullScores = this.fullScores
    const rows = [...whole, ...covered.filter((item) => !(wholeScores[item] > 0))].map((item) => ({
      id: this.idList[item],
      covered: coveredScores[item] * (spoken?.forms.length && formScore(this.itemForms[item], spoken) > 0 ? 1 + FORM_TIP : 1), full: fullScores[item], whole: wholeScores[item],
      exact: exact.get(item) ?? 0, words,
    }))
    for (const item of whole) wholeScores[item] = 0
    for (const item of full) fullScores[item] = 0
    for (const item of covered) {
      coveredScores[item] = 0
      coveredSeen[item] = 0
    }
    rows.sort((a, b) => b.covered - a.covered || b.full - a.full || b.whole - a.whole || a.id.localeCompare(b.id))
    return signatures && spoken ? this.chooseVariants(rows, signatures, spoken) : rows
  }

  /**
   * Items heard as the same brand keep the places they hold, and among
   * themselves the asked form comes first, then the asked strength; nothing
   * moves between brands. "Ketonal ampula" puts Ketonal's ampoules where
   * Ketonal stood, never another brand's ampoules above Ketonal.
   */
  private chooseVariants(rows: RankedItem[], signatures: Map<number, string>, spoken: SpokenForms): RankedItem[] {
    const brands = new Map<string, number[]>()
    rows.forEach((row, at) => {
      const brand = signatures.get(this.idIndex.get(row.id)!)
      if (brand === undefined) return
      const places = brands.get(brand)
      if (places) places.push(at)
      else brands.set(brand, [at])
    })
    const result = rows.slice()
    for (const places of brands.values()) {
      if (places.length < 2) continue
      const fit = places.map((at) => {
        const item = this.idIndex.get(rows[at].id)!
        return { at, form: formScore(this.itemForms[item], spoken), strength: spoken.strengths.some((amount) => this.itemAmounts[item].has(amount)) ? 1 : 0 }
      })
      fit.sort((a, b) => b.form - a.form || b.strength - a.strength || a.at - b.at)
      places.forEach((place, k) => { result[place] = rows[fit[k].at] })
    }
    return result
  }

  private fitItemScratch(): void {
    if (this.wholeScores.length >= this.idList.length) return
    const size = this.idList.length * 2
    this.wholeScores = new Float64Array(size)
    this.fullScores = new Float64Array(size)
    this.coveredScores = new Float64Array(size)
    this.bestScores = new Float64Array(size)
    this.coveredSeen = new Uint8Array(size)
    this.bestSeen = new Uint8Array(size)
    this.bestLabels = new Int32Array(size)
  }

  /**
   * Catalog words close to a spoken word, in the order the words were added.
   * Only words that can pass are looked at: dice needs a shared trigram, and
   * spelling slack k reaches folded lengths within k (none for short words,
   * which match only their exact folded spelling).
   */
  private matchWord(word: string): Map<string, number> {
    const grams = trigrams(word), letters = Array.from(word), foldedLetters = foldSpelling(word)
    const folded = letterCodes(foldedLetters), foldedBits = letterBits(folded)
    const slack = spellingSlack(folded.length)
    if (this.wordCounts.length < this.wordList.length) {
      this.wordCounts = new Int32Array(this.wordList.length * 2)
      this.wordScores = new Float64Array(this.wordList.length * 2)
    }
    const counts = this.wordCounts, touched: number[] = []
    for (const gram of grams) {
      for (const index of this.wordPostings.get(gram) ?? []) if (counts[index]++ === 0) touched.push(index)
    }
    // Dice over trigrams is 2 * shared / (both counts). A score is at least
    // 0.5, so 0 is "not matched".
    const scores = this.wordScores, matched: number[] = []
    const consider = (index: number) => {
      const entry = this.wordList[index]
      let score = 2 * counts[index] / (grams.size + entry.gramCount)
      if (score < 0.5) {
        const limit = Math.min(slack, spellingSlack(entry.folded.length))
        const distance = editDistance(folded, entry.folded, limit)
        if (distance <= limit) score = Math.max(score, 1 - distance / (2 * Math.max(folded.length, entry.folded.length)))
      }
      if (score < 0.5) return
      scores[index] = score
      matched.push(index)
    }
    for (const index of touched) if (2 * counts[index] / (grams.size + this.wordList[index].gramCount) >= 0.5) consider(index)
    if (folded.length < SLACK_FROM) {
      for (const index of this.shortFolded.get(foldedLetters.join("")) ?? []) if (!scores[index]) consider(index)
      if (slack) for (const index of this.shortSounds.get(soundKey(folded)) ?? []) if (!scores[index]) consider(index)
    } else {
      const reach = slack >> 1
      for (let length = Math.max(SLACK_FROM, folded.length - reach); length <= folded.length + reach; length++) {
        const limit = Math.min(slack, spellingSlack(length))
        if (2 * Math.abs(length - folded.length) > limit) continue
        const indices = this.byFoldedLength[length] ?? [], bits = this.bitsByFoldedLength[length] ?? []
        for (let k = 0; k < indices.length; k++) {
          if (2 * lettersApart(foldedBits, bits[k]) > limit) continue
          if (!scores[indices[k]]) consider(indices[k])
        }
      }
    }
    for (const index of touched) counts[index] = 0
    const result = new Map<string, number>()
    for (const index of matched.sort((a, b) => a - b)) {
      const entry = this.wordList[index]
      // Between equally close spellings prefer the shared beginning and the
      // spoken length: "ketanol" is Ketonal before Retinol or Ketan (flax oil).
      let prefix = 0
      while (prefix < 4 && letters[prefix] !== undefined && letters[prefix] === entry.letters[prefix]) prefix++
      result.set(entry.label, scores[index] + 0.03 * prefix - 0.03 * Math.abs(letters.length - entry.letters.length))
      scores[index] = 0
    }
    return result
  }

  /** Items scoring over any label (in first-scored order), and items touched
   * through a complete product name: two items matching the same words are
   * told apart by the whole request. Scores land in wholeScores/fullScores. */
  private scoreWhole(name: string): [number[], number[]] {
    const grams = trigrams(name)
    if (this.termCounts.length < this.termIds.length) this.termCounts = new Int32Array(this.termIds.length * 2)
    const counts = this.termCounts, touched: number[] = []
    for (const gram of grams) {
      for (const term of this.postings.get(gram) ?? []) if (counts[term]++ === 0) touched.push(term)
    }
    const wholeScores = this.wholeScores, fullScores = this.fullScores, whole: number[] = [], full: number[] = []
    for (const term of touched) {
      // Presentation ranking only, never a confidence/identity/approval gate.
      const score = 2 * counts[term] / (grams.size + this.termSizes[term])
      counts[term] = 0
      if (this.indexWords && this.termIsName[term]) {
        for (const item of this.termIds[term]) {
          if (!fullScores[item]) full.push(item)
          fullScores[item] = Math.max(fullScores[item], score)
        }
      }
      if (score < 0.3) continue
      for (const item of this.termIds[term]) {
        if (!wholeScores[item]) whole.push(item)
        wholeScores[item] = Math.max(wholeScores[item], score)
      }
    }
    return [whole, full]
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

/**
 * How much the asked form weighs between two brands heard almost alike: an
 * item of that form counts this much more of what its name words scored. It
 * only tips brands within a tenth of each other ("Ketanol ampula": Ketonal,
 * which has ampoules, over Ketanur shampoo); an item none of whose words was
 * heard scores nothing to multiply. Catalog benchmark 2026-11-05, brand
 * misheard by one dropped letter + form: first 85.3% without, 90.2% with.
 */
const FORM_TIP = 0.1

const SPOKEN = createSpokenForms((word) => foldSpelling(word).join(""))

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

/** The product words of a spoken request (spokenNameKey), one number per folded letter. */
export function spokenWordCodes(text: string): Int32Array[] {
  return spokenNameKey(text).split(" ").filter(Boolean).map((word) => letterCodes(Array.from(word)))
}

/** A word as the sound measures below compare it: folded, one number per letter. */
export function soundCodes(word: string): Int32Array {
  return letterCodes(foldSpelling(word.toLocaleLowerCase("az").replace(/-/gu, "")))
}

/**
 * How far a spoken word is from a product's name word, 0 to 1, by the
 * search's own measure, when the spoken word may be only the name's
 * beginning or end: the closest of the whole word and its beginnings and
 * endings at least as long as the spoken word less one letter, nor shorter
 * than four. Recognizers keep one end of a long name: "Enterol" for
 * Enterosgel, "Alqum" for Spazmalgon (docs/zeytun-line-recognition-plan.md 4.2).
 * Anything over `within` comes back as 1.
 */
export function soundPartApart(spoken: Int32Array, word: Int32Array, within: number): number {
  let best = 1
  const shortest = Math.max(4, spoken.length - 1)
  for (let length = word.length; length >= shortest; length--) {
    const scale = 2 * Math.max(spoken.length, length), limit = Math.floor(within * scale)
    // Shorter parts only get further from a longer spoken word.
    if (2 * (spoken.length - length) > limit) break
    if (2 * (length - spoken.length) > limit) continue
    const ends = length === word.length ? [word] : [word.subarray(0, length), word.subarray(word.length - length)]
    for (const part of ends) {
      const distance = editDistance(spoken, part, limit)
      if (distance <= limit) best = Math.min(best, distance / scale)
    }
  }
  return best
}

/**
 * How far apart two spoken words sound, 0 (the same) to 1, by the search's
 * own measure: half letters, a SOUND_CLASS swap costs half an edit. Takes
 * words of spokenNameKey. The line pairs the model's lookup with the second
 * recognizer's word for the same product (zeytun-chirp.ts).
 */
export function spokenWordsApart(left: string, right: string): number {
  const a = letterCodes(foldSpelling(left)), b = letterCodes(foldSpelling(right))
  const limit = 2 * Math.max(a.length, b.length)
  if (!limit) return 1
  return Math.min(editDistance(a, b, limit), limit) / limit
}

/**
 * A spoken request reduced to its product words, folded (alphabets, digraphs,
 * «г» as "q") and without quantity words: "Adexa beş qutu" and "adexa" are the
 * same key. Used to recognize a wording a manager has already confirmed.
 */
export function spokenNameKey(text: string): string {
  return [...new Set(pharmacyWords(normalizePharmacyLabel(text)))]
    .filter((word) => !QUANTITY_WORDS.has(word)).map((word) => foldSpelling(word).join("")).join(" ")
}
