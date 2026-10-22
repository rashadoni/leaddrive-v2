import { normalizePharmacyLabel } from "./contracts"

function trigrams(text: string): Set<string> {
  const characters = Array.from(`  ${text} `)
  const result = new Set<string>()
  for (let i = 0; i + 2 < characters.length; i++) result.add(characters.slice(i, i + 3).join(""))
  return result
}

/** Candidate discovery only. Owners must check tenant scope before calling. */
export class PharmacyNameSearch {
  private readonly terms = new Map<string, Set<string>>()
  private readonly postings = new Map<string, Set<string>>()
  private readonly sizes = new Map<string, number>()

  constructor(private readonly indexWords = false) {}

  add(id: string, rawName: string): void {
    const name = normalizePharmacyLabel(rawName)
    const labels = new Set([name])
    if (this.indexWords) {
      // Full feed names contain dose, brand and packaging in one long label.
      // Word entries improve discovery; they NEVER become approved aliases.
      for (const word of name.match(/[\p{L}\p{M}]+/gu) ?? []) {
        if (Array.from(word).length >= 3) labels.add(word)
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
    const grams = trigrams(name)
    const counts = new Map<string, number>()
    for (const gram of grams) {
      for (const term of this.postings.get(gram) ?? []) counts.set(term, (counts.get(term) ?? 0) + 1)
    }
    const scores = new Map<string, number>()
    for (const [term, count] of counts) {
      // Presentation ranking only, never a confidence/identity/approval gate.
      const score = 2 * count / (grams.size + this.sizes.get(term)!)
      if (score < 0.3) continue
      for (const id of this.terms.get(term)!) scores.set(id, Math.max(scores.get(id) ?? 0, score))
    }
    return [...scores].sort(([a, left], [b, right]) => right - left || a.localeCompare(b)).map(([id]) => id)
  }
}
