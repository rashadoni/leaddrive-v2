/**
 * How well the phone line's catalog search finds what a caller says, measured
 * on a whole 1C balance snapshot instead of the few names of one test call
 * (owner, 2026-11-03: "товаров 9к", not one product at a time).
 *
 * Every product name (its first word, 4+ letters) is said in Azerbaijani Latin
 * as a caller would ("Адефа" → "adefa", «г» → "q"), then misheard four ways:
 * exact, one sound swapped for an alike one (f→x, k→q, l→r…), one letter
 * swapped for an unrelated one, one letter dropped. For each it counts how
 * often an item of that name comes first and is among the five candidates the
 * agent gets. "exact" and "other" also show what a looser search costs.
 *
 *   node --import tsx scripts/zeytun-line/search-benchmark.ts <snapshot> [--misses]
 *
 * The snapshot is the line's own file on prod (/var/lib/leaddrive-v2/…/*.snapshot,
 * a JSON header line, then 1C's AvailableBalances response). It is the
 * client's catalog: keep copies out of Git.
 */
import { readFileSync } from "node:fs"

import { ZeytunAvailableBalances } from "../../src/lib/voice-agent/pharmacy/zeytun-available-balances"

const AZ_LATIN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "q", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts", ч: "ç", ш: "ş", щ: "ş", ъ: "",
  ы: "ı", ь: "", э: "e", ю: "yu", я: "ya",
}
const ALIKE: Record<string, string> = {
  f: "x", x: "h", k: "q", q: "k", g: "k", d: "t", t: "d", s: "z", z: "s", c: "j", l: "r", r: "l", m: "n", n: "m",
  b: "p", p: "b", v: "f", e: "a", a: "e", o: "u", u: "o", i: "y",
}
const OTHER: Record<string, string> = {
  a: "i", b: "s", c: "m", d: "l", e: "u", f: "n", g: "r", h: "b", i: "o", j: "t", k: "m", l: "p", m: "d", n: "z",
  o: "e", p: "r", q: "s", r: "b", s: "k", t: "n", u: "a", v: "s", x: "r", y: "d", z: "p",
}

const latin = (word: string) => Array.from(word.toLowerCase(), (ch) => AZ_LATIN[ch] ?? ch).join("")
const nameWord = (label: string) => (label.match(/^[\p{L}][\p{L}-]{3,}/u)?.[0] ?? "").toLowerCase()

function misheard(word: string): Record<string, string> {
  const at = Math.floor(word.length / 2), ch = word[at]
  const swap = (table: Record<string, string>) => word.slice(0, at) + (table[ch] ?? ch) + word.slice(at + 1)
  return { exact: word, alike: swap(ALIKE), other: swap(OTHER), dropped: word.slice(0, at) + word.slice(at + 1) }
}

async function main() {
  const [path, flag] = process.argv.slice(2)
  if (!path) throw new Error("usage: search-benchmark.ts <snapshot> [--misses]")
  const raw = readFileSync(path), newline = raw.indexOf(10)
  const goods = (JSON.parse(raw.subarray(newline + 1).toString()) as { data: { goods: { Номенклатура: { Наименование: string } }[] } }).data.goods
  const org = "benchmark"
  const feed = await ZeytunAvailableBalances.build(raw.subarray(newline + 1), { organizationId: org, observedAt: new Date().toISOString(), source: "attachment" })
  const names = new Map<string, string>()
  for (const row of goods) {
    const word = nameWord(row.Номенклатура.Наименование)
    if (word && !names.has(word)) names.set(word, latin(word))
  }
  const tally: Record<string, { first: number; five: number; n: number; misses: string[] }> = {}
  const started = Date.now()
  for (const [word, spoken] of names) {
    for (const [kind, query] of Object.entries(misheard(spoken))) {
      if (kind !== "exact" && query === spoken) continue
      const entry = (tally[kind] ??= { first: 0, five: 0, n: 0, misses: [] })
      entry.n++
      const got = feed.search(org, { text: query }).candidates.map((candidate) => nameWord(candidate.name))
      if (got[0] === word) entry.first++
      if (got.includes(word)) entry.five++
      else if (entry.misses.length < 15) entry.misses.push(`${query} (${word}) -> ${got.slice(0, 3).join(", ")}`)
    }
  }
  const searches = Object.values(tally).reduce((sum, entry) => sum + entry.n, 0)
  console.log(`names: ${names.size}, searches: ${searches}, ${((Date.now() - started) / searches).toFixed(2)} ms per search`)
  for (const [kind, entry] of Object.entries(tally)) {
    console.log(`${kind.padEnd(8)} first ${(100 * entry.first / entry.n).toFixed(1)}%  in five ${(100 * entry.five / entry.n).toFixed(1)}%  (${entry.n})`)
    if (flag === "--misses") for (const miss of entry.misses) console.log(`    ${miss}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
