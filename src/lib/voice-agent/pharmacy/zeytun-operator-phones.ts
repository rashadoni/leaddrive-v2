/**
 * Operators' numbers for the phone line (owner 2026-11-28: «ты номер привяжешь к
 * аптекам, который будет делать заказ»). For the Pharmastore pilot one or two
 * operators phone in the orders of a few pharmacies, from their own numbers,
 * which 1C does not know. A private file beside the line's grant binds each such
 * number to the 1C pharmacies (counterparty GUIDs) it orders for; the line then
 * treats the number as one 1C lists for those pharmacies: one is named in the
 * greeting, several are asked which (openingForCandidates).
 *
 *   { "phones": { "+994501234567": ["<1C counterparty GUID>", …] } }
 *
 * No file, or a file that is not this shape: no operator numbers, the line as before.
 */
export const ZEYTUN_OPERATOR_PHONES_FILE = "zeytun-operator-phones.json"

const PHONE = /^\+[1-9]\d{7,14}$/u
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
/** The greeting names at most four pharmacies (MAX_SPOKEN_CANDIDATES); more is never a pilot. */
export const OPERATOR_PHARMACIES_MAX = 4
const OPERATOR_PHONES_MAX = 20

/** Number → its pharmacies' GUIDs (lower case, in the file's order); an empty map for anything else. */
export function parseOperatorPhones(raw: unknown): Map<string, string[]> {
  const phones = (raw as { phones?: unknown } | null)?.phones
  const out = new Map<string, string[]>()
  if (!phones || typeof phones !== "object" || Array.isArray(phones)) return out
  const entries = Object.entries(phones as Record<string, unknown>)
  if (entries.length > OPERATOR_PHONES_MAX) return out
  for (const [phone, guids] of entries) {
    if (!PHONE.test(phone) || !Array.isArray(guids) || !guids.length || guids.length > OPERATOR_PHARMACIES_MAX) return new Map()
    const list = [...new Set(guids.map((guid) => String(guid).toLowerCase()))]
    if (!list.every((guid) => GUID.test(guid))) return new Map()
    out.set(phone, list)
  }
  return out
}

/** The operator's pharmacies that the 1C list still has, in the file's order; null when the number is no operator's. */
export function operatorPharmacies<T extends { guid: string }>(phones: Map<string, string[]>, phoneE164: string, all: readonly T[]): T[] | null {
  const guids = phones.get(phoneE164)
  if (!guids) return null
  const byGuid = new Map(all.map((pharmacy) => [pharmacy.guid.toLowerCase(), pharmacy]))
  return guids.flatMap((guid) => byGuid.get(guid) ?? [])
}
