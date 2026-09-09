import crypto from "crypto"

/**
 * Shared helpers for the configurable task axes — Task types ("type") and Event
 * types ("eventType"/channel). Both are org-wide colored editable lists whose
 * machine name is written to a String column on Task and validated dynamically.
 * Keeping the slug + validator here means the two axes never drift.
 */

// Azerbaijani/Turkish → ASCII so localized labels (Təchizat, Hüquq, İnzibati…)
// produce readable machine names instead of collapsing to a random key.
const TRANSLIT: Record<string, string> = {
  ə: "e", ı: "i", ş: "s", ç: "c", ğ: "g", ö: "o", ü: "u", "₼": "azn",
}

/**
 * Derive a stable lowercase machine name from a display label. `İ` (AZ dotted
 * capital I) is folded BEFORE toLowerCase — otherwise "İ".toLowerCase() yields
 * "i" + U+0307 combining dot, which would slug to "i_". The TRANSLIT map handles
 * the precomposed lowercase AZ letters; the NFD pass strips residual combining
 * diacritics from other locales. Falls back to a random key only when the label
 * has no transliterable/latin/digit characters.
 */
export function slugifyConfigName(label: string): string {
  const slug = label
    .replace(/İ/g, "i")
    .toLowerCase()
    .replace(/[əışçğöü₼]/g, (c) => TRANSLIT[c] ?? c)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
  return slug.length ? slug : "type_" + crypto.randomUUID().replace(/-/g, "").slice(0, 8)
}

/**
 * Dynamic validation for a configurable axis value. Accepts any value that EXISTS
 * for the org (active OR inactive — deactivating retires a value from NEW-task
 * pickers but must NOT invalidate tasks that already carry it). Empty/undefined is
 * allowed (the field is optional). Falls back to the legacy seed names only when
 * the org has none yet (brand-new tenant pre-seed).
 */
export async function isValidConfigType(
  findExisting: () => Promise<{ name: string }[]>,
  legacy: Set<string>,
  value?: string | null,
): Promise<boolean> {
  if (!value) return true
  const existing = await findExisting()
  if (existing.length === 0) return legacy.has(value)
  return existing.some((r) => r.name === value)
}
