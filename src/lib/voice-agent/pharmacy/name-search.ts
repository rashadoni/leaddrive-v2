import { normalizePharmacyLabel } from "./contracts"

function trigrams(text: string): Set<string> {
  const characters = Array.from(`  ${text} `)
  const result = new Set<string>()
  for (let i = 0; i + 2 < characters.length; i++) result.add(characters[i] + characters[i + 1] + characters[i + 2])
  return result
}

// Two rows of the distance table, reused: thousands of words are measured per spoken word.
let rows = [new Int32Array(64), new Int32Array(64)]

/** Levenshtein distance, or limit + 1 as soon as it is certainly above limit. */
function editDistance(left: Int32Array, right: Int32Array, limit: number): number {
  if (Math.abs(left.length - right.length) > limit) return limit + 1
  if (rows[0].length <= right.length) rows = [new Int32Array(right.length + 1), new Int32Array(right.length + 1)]
  let [previous, current] = rows
  for (let j = 0; j <= right.length; j++) previous[j] = j
  for (let i = 1; i <= left.length; i++) {
    current[0] = i
    let best = i
    for (let j = 1; j <= right.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1))
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

/** Which letters a word has, a bit per letter (a-z each their own; others may share a bit). */
function letterBits(codes: Int32Array): number {
  let bits = 0
  for (const code of codes) bits |= 1 << (code & 31)
  return bits
}

function bitCount(bits: number): number {
  bits -= (bits >>> 1) & 0x55555555
  bits = (bits & 0x33333333) + ((bits >>> 2) & 0x33333333)
  return Math.imul((bits + (bits >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24
}

/**
 * Every letter one word has and the other lacks costs an edit, and an edit
 * settles at most one such letter on each side: a lower bound on the
 * distance, far cheaper than computing it.
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
function foldSpelling(word: string): string[] {
  const latin = word.replace(/дж/gu, "c").replace(/[а-яё]/gu, (ch) => CYRILLIC_LATIN[ch] ?? ch).replace(/dj/gu, "c")
  return Array.from(latin.replace(/sh/gu, "ş").replace(/ch/gu, "ç").replace(/gh/gu, "ğ")
    .replace(/[şç]/gu, (ch) => (ch === "ş" ? "s" : "c")).replace(/ğ/gu, "g").replace(/ı/gu, "i")
    .replace(/ö/gu, "o").replace(/ü/gu, "u").replace(/ə/gu, "e"))
}

// Spoken names arrive through speech recognition: "Ketanol" for Ketonal,
// "Noşpa" for No-şpa. Short words get no slack, they collide too easily.
function spellingSlack(length: number): number {
  return length >= 7 ? 2 : length >= 5 ? 1 : 0
}

/** Words shorter than this, folded, match only their exact folded spelling (no slack). */
const SLACK_FROM = 5

interface IndexedWord { label: string; gramCount: number; letters: string[]; folded: Int32Array }

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
  private readonly postings = new Map<string, number[]>()
  private readonly words = new Map<string, number>()
  private readonly wordList: IndexedWord[] = []
  private readonly wordPostings = new Map<string, number[]>()
  /** Folded spelling → words, for words too short for slack. */
  private readonly shortFolded = new Map<string, number[]>()
  /** Folded length → words with slack, and which letters each has: slack k reaches only lengths within k. */
  private readonly byFoldedLength: number[][] = []
  private readonly bitsByFoldedLength: number[][] = []
  private readonly idIndex = new Map<string, number>()
  private readonly idList: string[] = []
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

  constructor(private readonly indexWords = false) {}

  add(id: string, rawName: string): void {
    const name = normalizePharmacyLabel(rawName)
    let item = this.idIndex.get(id)
    if (item === undefined) {
      item = this.idList.push(id) - 1
      this.idIndex.set(id, item)
    }
    const labels = new Set([name])
    if (this.indexWords) {
      // Full feed names contain dose, brand and packaging in one long label.
      // Word entries improve discovery; they NEVER become approved aliases.
      for (const word of pharmacyWords(name)) {
        labels.add(word)
        if (!this.words.has(word)) this.addWord(word)
      }
    }
    for (const label of labels) {
      const existing = this.terms.get(label)
      if (existing !== undefined) {
        this.termIds[existing].add(item)
        if (label === name) this.termIsName[existing] = true
        continue
      }
      const term = this.termIds.push(new Set([item])) - 1
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
    this.wordList.push({ label: word, gramCount: grams.size, letters: Array.from(word), folded })
    for (const gram of grams) {
      const words = this.wordPostings.get(gram)
      if (words) words.push(index)
      else this.wordPostings.set(gram, [index])
    }
    if (letters.length < SLACK_FROM) {
      const key = letters.join(""), same = this.shortFolded.get(key)
      if (same) same.push(index)
      else this.shortFolded.set(key, [index])
    } else {
      const length = letters.length
      this.byFoldedLength[length] ??= []
      this.bitsByFoldedLength[length] ??= []
      this.byFoldedLength[length].push(index)
      this.bitsByFoldedLength[length].push(letterBits(folded))
    }
  }

  find(rawName: string): string[] {
    const name = normalizePharmacyLabel(rawName)
    if (Array.from(name).length < 3) {
      const term = this.terms.get(name)
      return term === undefined ? [] : [...this.termIds[term]].map((item) => this.idList[item])
    }
    this.fitItemScratch()
    const [whole, full] = this.scoreWhole(name)
    // A spoken request is "No-şpa ampula": scored only as one string, the
    // form word matches every ampoule in the feed as well as the name does,
    // and the medicine itself falls out of the five candidates returned.
    // Rank by how many of the caller's words an item matches first, each word
    // weighted by how rare it is in the feed: "noşpa" names three items,
    // "ampula" two hundred and "qutu" thousands.
    const covered: number[] = []
    const coveredScores = this.coveredScores, coveredSeen = this.coveredSeen, bestScores = this.bestScores, bestSeen = this.bestSeen
    for (const word of this.indexWords ? new Set(pharmacyWords(name)) : []) {
      if (QUANTITY_WORDS.has(word)) continue
      const matches = this.matchWord(word)
      if (!matches.size) continue
      // The word's weight comes from its closest spelling, so a rarer but
      // more distant word (Retinol for "ketanol") cannot outrank Ketonal.
      let closest = "", closestScore = -Infinity
      for (const [label, score] of matches) {
        if (score > closestScore || (score === closestScore && label.localeCompare(closest) < 0)) [closest, closestScore] = [label, score]
      }
      const weight = Math.log(1 + this.idList.length / this.termIds[this.terms.get(closest)!].size)
      const best: number[] = []
      for (const [label, score] of matches) {
        for (const item of this.termIds[this.terms.get(label)!]) {
          if (!bestSeen[item]) {
            bestSeen[item] = 1
            best.push(item)
            bestScores[item] = Math.max(0, score * weight)
          } else bestScores[item] = Math.max(bestScores[item], score * weight)
        }
      }
      for (const item of best) {
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
      id: this.idList[item], covered: coveredScores[item], full: fullScores[item], whole: wholeScores[item],
    }))
    for (const item of whole) wholeScores[item] = 0
    for (const item of full) fullScores[item] = 0
    for (const item of covered) {
      coveredScores[item] = 0
      coveredSeen[item] = 0
    }
    rows.sort((a, b) => b.covered - a.covered || b.full - a.full || b.whole - a.whole || a.id.localeCompare(b.id))
    return rows.map((row) => row.id)
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
        if (distance <= limit) score = Math.max(score, 1 - distance / Math.max(folded.length, entry.folded.length))
      }
      if (score < 0.5) return
      scores[index] = score
      matched.push(index)
    }
    for (const index of touched) if (2 * counts[index] / (grams.size + this.wordList[index].gramCount) >= 0.5) consider(index)
    if (slack === 0) {
      for (const index of this.shortFolded.get(foldedLetters.join("")) ?? []) if (!scores[index]) consider(index)
    } else {
      for (let length = Math.max(SLACK_FROM, folded.length - slack); length <= folded.length + slack; length++) {
        const limit = Math.min(slack, spellingSlack(length))
        if (Math.abs(length - folded.length) > limit) continue
        const indices = this.byFoldedLength[length] ?? [], bits = this.bitsByFoldedLength[length] ?? []
        for (let k = 0; k < indices.length; k++) {
          if (lettersApart(foldedBits, bits[k]) > limit) continue
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
