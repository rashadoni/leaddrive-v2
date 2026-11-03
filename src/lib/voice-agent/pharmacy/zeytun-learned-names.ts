import { spokenNameKey } from "./name-search"

/**
 * What the line learns from orders a manager confirmed (owner, 2026-11-03:
 * «товаров 9к» — not a fix per product). Each confirmed line pairs what the
 * caller said, as the agent heard it, with the 1C product the manager let
 * through, after any correction of his own. Nothing is kept but these pairs.
 */
export interface ConfirmedLine { spoken: string; externalId: string }

export interface LearnedNames {
  /** The product a wording has led to, when every confirmed line with that wording agrees. */
  productFor(text: string): string | null
  /** Ordered products, most often first. */
  ordered(limit: number): string[]
}

/**
 * `written`: every product the line wrote, confirmed or not (owner's call
 * 2026-11-03: with no confirmed order yet the recognizer had no hint at all,
 * and Ketonal came back as "etanol"). Only confirmed lines teach wordings.
 */
export function learnNames(lines: ConfirmedLine[], written: string[] = lines.map((line) => line.externalId)): LearnedNames {
  const byKey = new Map<string, Set<string>>(), counts = new Map<string, number>()
  for (const id of written) counts.set(id, (counts.get(id) ?? 0) + 1)
  for (const line of lines) {
    const key = spokenNameKey(line.spoken)
    // "—" is a line the manager added himself: nobody said it.
    if (!key) continue
    const products = byKey.get(key) ?? new Set<string>()
    byKey.set(key, products.add(line.externalId))
  }
  const ordered = [...counts].sort(([a, left], [b, right]) => right - left || a.localeCompare(b)).map(([id]) => id)
  return {
    productFor(text) {
      const products = byKey.get(spokenNameKey(text))
      // Two products for one wording ("Noşpa": 40 mg and forte): the caller still has to say which.
      return products?.size === 1 ? [...products][0] : null
    },
    ordered: (limit) => ordered.slice(0, limit),
  }
}

const AZ_LATIN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "q", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts", ч: "ç", ш: "ş", щ: "ş", ъ: "",
  ы: "ı", ь: "", э: "e", ю: "yu", я: "ya",
}

/**
 * The product's own name as a caller in Baku says it, for the recognizer's
 * hint list: the first word of the 1C label in Azerbaijani letters
 * ("Аджиколд № 4 (Таблетки)…" → "Acikold"). Not the Azerbaijani label first:
 * it often starts with the substance ("Drotaverin hidroxlorid…" is No-şpa).
 * Null when neither label starts with a name of three letters or more.
 */
export function spokenProductName(item: { name: string; nameAz: string | null }): string | null {
  const word = (label: string | null) => label?.match(/^[\p{L}][\p{L}-]{2,}/u)?.[0] ?? null
  const russian = word(item.name)?.toLowerCase().replace(/дж/gu, "c").replace(/[а-яё]/gu, (ch) => AZ_LATIN[ch] ?? ch)
  const latin = russian && /^[\p{Script=Latin}-]+$/u.test(russian) ? russian : word(item.nameAz)
  if (!latin || !/^[\p{Script=Latin}-]+$/u.test(latin)) return null
  return latin.charAt(0).toUpperCase() + latin.slice(1)
}
