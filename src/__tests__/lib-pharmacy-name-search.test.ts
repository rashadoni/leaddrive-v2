import { describe, expect, it } from "vitest"
import { PharmacyNameSearch } from "@/lib/voice-agent/pharmacy/name-search"

// Labels copied in shape from the Zeytun feed (2026-10-23 live probe): the
// medicine shares its form word with hundreds of other items, and speech
// recognition delivers "Noşpa" for No-şpa and "Ketanol" for Ketonal.
const FEED: Array<[string, string]> = [
  ["nospa-amp", "No-şpa 2ml 40 mq № 25( drotaverin) (Ampula) (Sanofi Aventis) (Macarıstan)"],
  ["nospa-forte", "No-şpa forte 80 mq № 24 (Drotaverine) /*qutu/* \\*Xinoin, Macarıstan\\*"],
  ["ketonal-amp", "Ketonal 2 ml № 10  /*qutu/*  \\*LEK ,Sloveniya\\*"],
  ["ketonal-krem", "Ketonal 30 qr (Krem) (LEK) (Sloveniya)"],
  ["flax-oil", "Масло семян льна(Ketan toxumu yagi)(Zeyerek yagi) 100 ml (Yağ) (Biola) (Azərbaycan)"],
  ["retinol", "Artshine Retinol 0,5% 30 ml (Serum) (Vitamin Grup) (Türkiyə)"],
  ["diklofenak-sam", "Diklofenak 100 mq № 10 (Şam) (Farmaprim) (Moldova)"],
  ["diklofenak-gel", "Diklofenak 40 qr (Gel) (Hemopharma) (Serbiya)"],
  ["nimesil", "Nimesil 100 mq № 30 /*qutu/* \\* Berlin-Chemie ,Almaniya\\*"],
  ["persen", "Persen forte № 20 /*qutu/*  \\*Lek Farmasyutikals DD.Sloveniya\\*"],
]
for (let i = 0; i < 40; i++) FEED.push([`ampoule-${i}`, `Preparat${String.fromCharCode(97 + (i % 26))}${i} 1 qr № 1 (Ampula) (Firma) (Ölkə)`])

function search() {
  const index = new PharmacyNameSearch(true)
  for (const [id, label] of FEED) index.add(id, label)
  return index
}

describe("PharmacyNameSearch word ranking for spoken requests", () => {
  it("puts the named medicine above every other item sharing its form word", () => {
    const top = search().find("Noşpa ampula").slice(0, 2)
    expect(top).toEqual(["nospa-amp", "nospa-forte"])
    expect(search().find("No-şpa ampula")[0]).toBe("nospa-amp")
  })

  it("finds a hyphenated name spoken without the hyphen", () => {
    expect(search().find("Noşpa").slice(0, 2).sort()).toEqual(["nospa-amp", "nospa-forte"])
  })

  it("reads a misheard name as the closest catalog spelling, not a rarer or shorter one", () => {
    const top = search().find("Ketanol").slice(0, 2).sort()
    expect(top).toEqual(["ketonal-amp", "ketonal-krem"])
  })

  it("lets quantity words decide nothing", () => {
    const top = search().find("Ketanol üç qutu").slice(0, 2).sort()
    expect(top).toEqual(["ketonal-amp", "ketonal-krem"])
  })

  it("keeps a misheard form word harmless when the name is right", () => {
    expect(search().find("Diklofenak axşamı 100 mq")[0]).toBe("diklofenak-sam")
    expect(search().find("Diklofenak şam 100 mq")[0]).toBe("diklofenak-sam")
  })

  it("treats Azerbaijani letters and their Latin digraphs as one sound", () => {
    // 2026-10-23 live call: "No-şpa" was transcribed "Moshpa", "Ketonal" "Ketenal".
    expect(search().find("Moshpa ampula")[0]).toBe("nospa-amp")
    expect(search().find("Ketenal").slice(0, 2).sort()).toEqual(["ketonal-amp", "ketonal-krem"])
  })

  it("gives short words no spelling slack", () => {
    // "gel" must not reach "gal", "bel", ... by one edit.
    expect(search().find("Diklofenak gel")[0]).toBe("diklofenak-gel")
  })

  it("leaves whole-label search unchanged when words are not indexed", () => {
    const index = new PharmacyNameSearch()
    for (const [id, label] of FEED) index.add(id, label)
    expect(index.find("Noşpa ampula")).not.toContain("ketonal-amp")
    expect(index.find("Ketonal 30 qr (Krem) (LEK) (Sloveniya)")[0]).toBe("ketonal-krem")
  })

  // Live call 2026-10-28: "Adefa" found nothing. Two of three Zeytun feed
  // names are Cyrillic only; the caller's words arrive in Azerbaijani Latin.
  it("finds a Cyrillic-only feed name from the caller's Latin spelling", () => {
    const index = search()
    index.add("adefa", "Адефа № 30 (Таблетки) (Pharmex Rom Industry Srl) (Румыния)")
    index.add("adzhisept", "Аджисепт ананас № 24 (Пастилки) (AGİO PHARMACEUTİCALS LTD,) (Индия)")
    index.add("glukoza", "Глюкоза 5% 200 мл (Раствор) (Новофарм) (Украина)")
    index.add("shalfey", "Шалфей № 20 (Пастилки) (Натур Продукт) (Нидерланды)")
    expect(index.find("Adefa")[0]).toBe("adefa")
    expect(index.find("Adefa otuzluq tablet")[0]).toBe("adefa")
    // Owner's call 2026-10-29: recognition heard "Adexa", "Adelfa", "Ədəfa".
    expect(index.find("Adexa")[0]).toBe("adefa")
    expect(index.find("Adelfa")[0]).toBe("adefa")
    expect(index.find("Ədəfa")[0]).toBe("adefa")
    expect(index.find("Acisept ananas")[0]).toBe("adzhisept")
    expect(index.find("Ajisept")[0]).toBe("adzhisept")
    expect(index.find("Qlükoza")[0]).toBe("glukoza")
    expect(index.find("Şalfey")[0]).toBe("shalfey")
    expect(index.find("Shalfey")[0]).toBe("shalfey")
    // The Latin feed is ranked as before.
    expect(index.find("Ketanol").slice(0, 2).sort()).toEqual(["ketonal-amp", "ketonal-krem"])
  })
})

// The index skips words and labels that cannot score; it must answer exactly
// as the plain scan of every word and label it replaced (2026-10-28: on
// prod's 9 176 items that scan held the web process 0.1-0.9 s a request).
// This is that scan, kept as the definition the index must reproduce.
class ScanSearch {
  private readonly terms = new Map<string, Set<string>>()
  private readonly postings = new Map<string, Set<string>>()
  private readonly sizes = new Map<string, number>()
  private readonly words = new Map<string, { grams: Set<string>; letters: string[]; folded: string[] }>()
  private readonly ids = new Set<string>()
  private readonly fullLabels = new Set<string>()

  add(id: string, rawName: string): void {
    const name = rawName.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase()
    this.ids.add(id)
    this.fullLabels.add(name)
    const labels = new Set([name])
    for (const word of scanWords(name)) {
      labels.add(word)
      if (!this.words.has(word)) this.words.set(word, { grams: scanTrigrams(word), letters: Array.from(word), folded: scanFold(word) })
    }
    for (const label of labels) {
      const existing = this.terms.get(label)
      if (existing) { existing.add(id); continue }
      this.terms.set(label, new Set([id]))
      const grams = scanTrigrams(label)
      this.sizes.set(label, grams.size)
      for (const gram of grams) {
        const terms = this.postings.get(gram)
        if (terms) terms.add(label)
        else this.postings.set(gram, new Set([label]))
      }
    }
  }

  find(rawName: string): string[] {
    const name = rawName.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase()
    if (Array.from(name).length < 3) return [...(this.terms.get(name) ?? [])]
    const grams = scanTrigrams(name), counts = new Map<string, number>()
    for (const gram of grams) for (const term of this.postings.get(gram) ?? []) counts.set(term, (counts.get(term) ?? 0) + 1)
    const whole = new Map<string, number>(), full = new Map<string, number>()
    for (const [term, count] of counts) {
      const score = 2 * count / (grams.size + this.sizes.get(term)!)
      if (this.fullLabels.has(term)) for (const id of this.terms.get(term)!) full.set(id, Math.max(full.get(id) ?? 0, score))
      if (score < 0.3) continue
      for (const id of this.terms.get(term)!) whole.set(id, Math.max(whole.get(id) ?? 0, score))
    }
    const covered = new Map<string, number>()
    for (const word of new Set(scanWords(name))) {
      if (SCAN_QUANTITY.has(word)) continue
      const matches = this.matchWord(word)
      if (!matches.size) continue
      const [closest] = [...matches].sort(([a, left], [b, right]) => right - left || a.localeCompare(b))[0]
      const weight = Math.log(1 + this.ids.size / this.terms.get(closest)!.size)
      const best = new Map<string, number>()
      for (const [label, score] of matches) for (const id of this.terms.get(label)!) best.set(id, Math.max(best.get(id) ?? 0, score * weight))
      for (const [id, score] of best) covered.set(id, (covered.get(id) ?? 0) + score)
    }
    const by = (scores: Map<string, number>, a: string, b: string) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0)
    return [...new Set([...whole.keys(), ...covered.keys()])].sort((a, b) => by(covered, a, b) || by(full, a, b) || by(whole, a, b) || a.localeCompare(b))
  }

  private matchWord(word: string): Map<string, number> {
    const grams = scanTrigrams(word), letters = Array.from(word), folded = scanFold(word)
    const slack = scanSlack(folded.length), result = new Map<string, number>()
    for (const [label, entry] of this.words) {
      let shared = 0
      for (const gram of grams) if (entry.grams.has(gram)) shared++
      let score = 2 * shared / (grams.size + entry.grams.size)
      const limit = Math.min(slack, scanSlack(entry.folded.length))
      if (score < 0.5) {
        const distance = scanDistance(folded, entry.folded, limit)
        if (distance <= limit) score = Math.max(score, 1 - distance / Math.max(folded.length, entry.folded.length))
      }
      if (score < 0.5) continue
      let prefix = 0
      while (prefix < 4 && letters[prefix] !== undefined && letters[prefix] === entry.letters[prefix]) prefix++
      result.set(label, score + 0.03 * prefix - 0.03 * Math.abs(letters.length - entry.letters.length))
    }
    return result
  }
}

function scanTrigrams(text: string): Set<string> {
  const characters = Array.from(`  ${text} `), result = new Set<string>()
  for (let i = 0; i + 2 < characters.length; i++) result.add(characters[i] + characters[i + 1] + characters[i + 2])
  return result
}

function scanDistance(left: string[], right: string[], limit: number): number {
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

const SCAN_CYRILLIC: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "o", ж: "j", з: "z", и: "i", й: "y", к: "k", л: "l",
  м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "s", ч: "ç", ш: "ş",
  щ: "ş", ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya",
}
function scanFold(word: string): string[] {
  const latin = word.replace(/дж/gu, "c").replace(/[а-яё]/gu, (ch) => SCAN_CYRILLIC[ch] ?? ch).replace(/dj/gu, "c")
  return Array.from(latin.replace(/sh/gu, "ş").replace(/ch/gu, "ç").replace(/gh/gu, "ğ")
    .replace(/[şç]/gu, (ch) => (ch === "ş" ? "s" : "c")).replace(/ğ/gu, "g").replace(/ı/gu, "i")
    .replace(/ö/gu, "o").replace(/ü/gu, "u").replace(/ə/gu, "e"))
}
const scanSlack = (length: number) => (length >= 7 ? 2 : length >= 5 ? 1 : 0)
const SCAN_QUANTITY = new Set([
  "qutu", "qutusu", "qutudan", "ədəd", "dənə", "paket", "bir", "iki", "üç", "dörd", "beş", "altı", "yeddi",
  "səkkiz", "doqquz", "iyirmi", "otuz", "qırx", "əlli", "altmış", "yetmiş", "səksən", "doxsan", "yüz", "min",
  "lazımdır", "istəyirəm", "yazın", "olsun",
])
function scanWords(name: string): string[] {
  const result: string[] = []
  for (const word of name.match(/[\p{L}\p{M}]+/gu) ?? []) if (Array.from(word).length >= 3) result.push(word)
  for (const joined of name.match(/[\p{L}\p{M}]+(?:-[\p{L}\p{M}]+)+/gu) ?? []) result.push(joined.replace(/-/gu, ""))
  return result
}

describe("PharmacyNameSearch answers exactly as a scan of the whole index", () => {
  it("returns the same ids in the same order for spoken, misheard and full requests", () => {
    let seed = 1028
    const random = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32)
    const pick = <T,>(list: T[]) => list[Math.floor(random() * list.length)]
    const latin = Array.from("abcdefgiklmnoprstuvxyzəışçöüğ"), cyrillic = Array.from("абвгдежзийклмнопрстуфхцчшщыэюя")
    const spell = (letters: string[]) => Array.from({ length: 2 + Math.floor(random() * 9) }, () => pick(letters)).join("")
    // Few distinct words, so many items share each one: ties, common form
    // words and near spellings are the cases an index can get wrong.
    const vocabulary = [...Array.from({ length: 150 }, () => spell(latin)), ...Array.from({ length: 150 }, () => spell(cyrillic)),
      "no-şpa", "ketonal", "ketanol", "retinol", "ampula", "таблетки", "qutu", "Адефа", "аджисепт", "şalfey"]
    const typo = (word: string) => {
      const letters = Array.from(word), at = Math.floor(random() * letters.length)
      if (random() < 0.5) letters[at] = pick(latin)
      else letters.splice(at, 1)
      return letters.join("")
    }
    const labels: string[] = []
    const index = new PharmacyNameSearch(true), scan = new ScanSearch()
    const add = (id: string, label: string) => { index.add(id, label); scan.add(id, label); labels.push(label) }
    const queries = () => {
      const words = pick(labels).toLowerCase().match(/[\p{L}\p{M}-]+/gu) ?? ["x"]
      return [pick(words), typo(pick(words)), words.slice(0, 2).join(" ") + " beş qutu", words.map(typo).join(" "), pick(labels),
        pick(words).replace(/[а-я]/gu, (ch) => SCAN_CYRILLIC[ch] ?? ch), pick(words).slice(0, 2), pick(vocabulary)]
    }
    for (let i = 0; i < 300; i++) {
      const name = Array.from({ length: 1 + Math.floor(random() * 4) }, () => pick(vocabulary)).join(" ")
      add(`item-${i}`, `${name} ${Math.floor(random() * 500)} mq № ${Math.floor(random() * 50)} (${pick(vocabulary)})`)
      if (random() < 0.3) add(`item-${i}`, name)
      if (random() < 0.05) add(`item-${Math.floor(random() * (i + 1))}`, name)
    }
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < 150; i++) for (const query of queries()) expect(index.find(query), query).toEqual(scan.find(query))
      // Items added after a search: the per-call buffers must grow with the index.
      for (let i = 0; i < 200; i++) add(`late-${round}-${i}`, `${pick(vocabulary)} ${pick(vocabulary)} ${spell(cyrillic)}`)
    }
  })
})
