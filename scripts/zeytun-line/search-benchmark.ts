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
import { performance } from "node:perf_hooks"

import { ZeytunAvailableBalances } from "../../src/lib/voice-agent/pharmacy/zeytun-available-balances"
import { ASSORTMENT_MARGIN, ASSORTMENT_WITHIN } from "../../src/lib/voice-agent/pharmacy/zeytun-assortment-ranking"

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

/** A seeded random stream (mulberry32): the same simulated pharmacies on every run. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * `--assortment [size]`: the pharmacy's own list (zeytun-pharmacy-assortment.ts) — a MODEL,
 * no real pharmacy history exists yet (2026-11-04: 1C SaleHistory answers empty, the CRM has
 * one confirmed order). Each search gets its own simulated pharmacy: `size` products drawn at
 * random from the catalog, the name searched for either IN the list (one item of it, the
 * pharmacy orders that one) or OUT of it (no item of that name). The same misheard words as
 * above; "in seven" adds the up-to-two products shown after the five. OUT must not be worse
 * than without a list — that is the harm the lift may not do.
 */
async function assortmentRun(feed: ZeytunAvailableBalances, org: string, names: Map<string, string>,
  itemsByWord: Map<string, string[]>, allIds: string[], size: number, within: number, margin: number, every: number) {
  const draw = random(20261104)
  const pick = (exclude: ReadonlySet<string>, include: string | null) => {
    const list = new Set<string>(include ? [include] : [])
    while (list.size < size) {
      const id = allIds[Math.floor(draw() * allIds.length)]
      if (!exclude.has(id)) list.add(id)
    }
    // Most ordered first: where the pharmacy's own product stands in its list is drawn too.
    const ordered = [...list]
    if (include) ordered.splice(0, 1).forEach((id) => ordered.splice(Math.floor(draw() * ordered.length), 0, id))
    return { ordered }
  }
  type Tally = { first: number; two: number; five: number; seven: number; noise: number; n: number }
  const tally: Record<string, Record<"base" | "in" | "out", Tally>> = {}
  const time = { base: 0, prefer: 0, n: 0 }
  const counts = (entry: Tally, result: ReturnType<ZeytunAvailableBalances["search"]>, word: string) => {
    entry.n++
    const five = result.candidates.map((candidate) => nameWord(candidate.name))
    const extra = ("preferredExtra" in result ? result.preferredExtra ?? [] : []).map((candidate) => nameWord(candidate.name))
    if (five[0] === word) entry.first++
    if (five.slice(0, 2).includes(word)) entry.two++
    if (five.includes(word)) entry.five++
    if (five.includes(word) || extra.includes(word)) entry.seven++
    // Products of the list shown after the five that are not what was said: what the agent has to look past.
    if (extra.some((name) => name !== word)) entry.noise++
  }
  let index = 0
  for (const [word, spoken] of names) {
    if (index++ % every) continue
    const own = new Set(itemsByWord.get(word) ?? [])
    for (const [kind, query] of Object.entries(misheard(spoken))) {
      if (kind !== "exact" && query === spoken) continue
      const entry = (tally[kind] ??= { base: { first: 0, two: 0, five: 0, seven: 0, noise: 0, n: 0 }, in: { first: 0, two: 0, five: 0, seven: 0, noise: 0, n: 0 },
        out: { first: 0, two: 0, five: 0, seven: 0, noise: 0, n: 0 } })
      let started = performance.now()
      counts(entry.base, feed.search(org, { text: query }), word)
      time.base += performance.now() - started
      const ordered = [...own][Math.floor(draw() * own.size)]
      started = performance.now()
      counts(entry.in, feed.search(org, { text: query }, undefined, { assortment: pick(own, ordered), within, margin }), word)
      time.prefer += performance.now() - started
      time.n++
      counts(entry.out, feed.search(org, { text: query }, undefined, { assortment: pick(own, null), within, margin }), word)
    }
  }
  const pct = (part: number, n: number) => `${(100 * part / n).toFixed(1)}%`.padStart(6)
  console.log(`assortment MODEL: ${size} random products per pharmacy, every ${every} name, within ${within}, margin ${margin}; ` +
    `${(time.base / time.n).toFixed(2)} ms per search without, ${(time.prefer / time.n).toFixed(2)} ms with a list`)
  console.log("kind      list   first  in two  in five  in seven  other product after the five")
  for (const [kind, entry] of Object.entries(tally)) {
    for (const [mode, row] of Object.entries(entry)) {
      const label = mode === "base" ? "none" : mode === "in" ? "IN" : "OUT"
      console.log(`${kind.padEnd(9)} ${label.padEnd(5)} ${pct(row.first, row.n)}  ${pct(row.two, row.n)}  ${pct(row.five, row.n)}  ${pct(row.seven, row.n)}   ${pct(row.noise, row.n)}  (${row.n})`)
    }
  }
}

/**
 * `--calls <labels.jsonl> <ordered-by-call.txt>`: the model's own lookups on real calls
 * (recognizer-benchmark.ts labels: "expected" product ids, "heardByModel" queries, "order"
 * TS-number), each searched with and without the pharmacy's list. A MODEL as well: the owner's
 * test calls stand for one pharmacy, and its list is what the orders BEFORE the phrase's order
 * held ("providerCallId|TS-number|externalId" lines, read-only from prod; the phrase's own order
 * is never in it). A product is found when an id of it is among the five (or seven) of any
 * query of its phrase, as recognizer-benchmark counts; IN / OUT — whether its id was in the list.
 */
async function callsRun(feed: ZeytunAvailableBalances, org: string, labelsPath: string, historyPath: string) {
  const number = (order: string) => Number(order.replace(/^TS-/u, ""))
  const orders = readFileSync(historyPath, "utf8").split("\n").filter(Boolean).map((line) => line.split("|"))
  // The list as the CRM keeps it: products of the earlier orders, most often ordered first.
  const before = (order: string) => {
    const counts = new Map<string, number>()
    for (const [, ts, id] of orders) if (number(ts) < number(order)) counts.set(id, (counts.get(id) ?? 0) + 1)
    return [...counts].sort(([, a], [, b]) => b - a).map(([id]) => id)
  }
  const within = Number(process.env.WITHIN ?? ASSORTMENT_WITHIN), margin = Number(process.env.MARGIN ?? ASSORTMENT_MARGIN)
  type Tally = { first: number; five: number; seven: number; noise: number; n: number }
  const tally: Record<string, Tally> = {}
  const add = (key: string, first: boolean, five: boolean, seven: boolean, noise: boolean) => {
    const entry = (tally[key] ??= { first: 0, five: 0, seven: 0, noise: 0, n: 0 })
    entry.n++; if (first) entry.first++; if (five) entry.five++; if (seven) entry.seven++; if (noise) entry.noise++
  }
  const misses: string[] = []
  for (const line of readFileSync(labelsPath, "utf8").split("\n").filter(Boolean)) {
    const label = JSON.parse(line) as { order?: string; expected: string[]; heardByModel?: string | string[]; use?: boolean }
    const queries = [label.heardByModel ?? []].flat().filter(Boolean)
    if (label.use === false || !label.expected.length || !queries.length || !label.order || !/^TS-\d+(?:\.\d+)?$/u.test(label.order)) continue
    const list = before(label.order)
    for (const expected of label.expected) {
      const side = list.includes(expected) ? "IN" : "OUT"
      for (const [mode, assortment] of [["none", null], ["list", { ordered: list }]] as const) {
        let first = false, five = false, seven = false, noise = false
        for (const text of queries) {
          const result = feed.search(org, { text }, undefined, { assortment, within, margin })
          const ids = result.candidates.map((candidate) => candidate.externalId)
          const extra = (result.preferredExtra ?? []).map((candidate) => candidate.externalId)
          first ||= ids[0] === expected; five ||= ids.includes(expected); seven ||= ids.includes(expected) || extra.includes(expected)
          noise ||= extra.some((id) => id !== expected)
        }
        add(`${side} ${mode}`, first, five, seven, noise)
        if (mode === "list" && !five) misses.push(`${side} ${queries.join(" / ")}${seven ? " (after the five)" : ""}`)
      }
    }
  }
  const pct = (part: number, n: number) => `${part}/${n}`.padStart(7)
  console.log(`calls MODEL: the owner's test calls as one pharmacy, its list = orders before the phrase's order`)
  console.log(`within ${within}, margin ${margin}`)
  console.log("product  list   first  in five  in seven  other product after the five")
  for (const key of ["IN none", "IN list", "OUT none", "OUT list"]) {
    const row = tally[key]
    if (row) console.log(`${key.padEnd(14)} ${pct(row.first, row.n)}  ${pct(row.five, row.n)}  ${pct(row.seven, row.n)}   ${pct(row.noise, row.n)}`)
  }
  if (process.env.MISSES) for (const miss of misses) console.log(`    not in five: ${miss}`)
}

async function main() {
  const args = process.argv.slice(2)
  const [path, flag] = args
  if (!path) throw new Error("usage: search-benchmark.ts <snapshot> [--misses | --assortment [size] | --calls <labels.jsonl> <ordered-by-call.txt>]")
  const raw = readFileSync(path), newline = raw.indexOf(10)
  const goods = (JSON.parse(raw.subarray(newline + 1).toString()) as { data: { goods: { Номенклатура: { Наименование: string } }[] } }).data.goods
  const org = "benchmark"
  const feed = await ZeytunAvailableBalances.build(raw.subarray(newline + 1), { organizationId: org, observedAt: new Date().toISOString(), source: "attachment" })
  const names = new Map<string, string>()
  for (const row of goods) {
    const word = nameWord(row.Номенклатура.Наименование)
    if (word && !names.has(word)) names.set(word, latin(word))
  }
  if (flag === "--calls") return callsRun(feed, org, args[2], args[3])
  if (flag === "--assortment") {
    const itemsByWord = new Map<string, string[]>(), allIds: string[] = []
    for (const item of feed.labels(org)) {
      allIds.push(item.externalId)
      const word = nameWord(item.name)
      if (word && names.has(word)) itemsByWord.set(word, [...(itemsByWord.get(word) ?? []), item.externalId])
    }
    // For a sweep: WITHIN=0.4 tries another slack; EVERY=3 searches every third name.
    return assortmentRun(feed, org, names, itemsByWord, allIds, Number(args[2] ?? 200), Number(process.env.WITHIN ?? ASSORTMENT_WITHIN),
      Number(process.env.MARGIN ?? ASSORTMENT_MARGIN), Number(process.env.EVERY ?? 1))
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
