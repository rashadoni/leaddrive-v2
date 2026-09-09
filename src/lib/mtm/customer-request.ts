export interface MtmCustomerDuplicateInput {
  externalCode?: string | null
  name: string
  phone?: string | null
  latitude?: number | null
  longitude?: number | null
}

export interface MtmCustomerDuplicateRow {
  id: string
  code: string | null
  name: string
  phone: string | null
  address: string | null
  latitude: number | null
  longitude: number | null
}

export interface MtmCustomerDuplicateCandidate extends MtmCustomerDuplicateRow {
  reasons: Array<"EXTERNAL_CODE" | "PHONE" | "LOCATION" | "SIMILAR_NAME">
  score: number
  exact: boolean
  distanceMeters: number | null
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\p{L}]+/gu, " ")
    .trim()
}

export function normalizeMtmPhone(value?: string | null): string {
  const digits = value?.replace(/\D/g, "") ?? ""
  return digits.length > 9 ? digits.slice(-9) : digits
}

function bigrams(value: string): Set<string> {
  const compact = normalizeText(value).replace(/\s/g, "")
  if (compact.length < 2) return new Set(compact ? [compact] : [])
  return new Set(Array.from({ length: compact.length - 1 }, (_, index) => compact.slice(index, index + 2)))
}

export function mtmNameSimilarity(left: string, right: string): number {
  const a = bigrams(left)
  const b = bigrams(right)
  if (a.size === 0 || b.size === 0) return 0
  let overlap = 0
  for (const gram of a) if (b.has(gram)) overlap += 1
  return (2 * overlap) / (a.size + b.size)
}

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const radius = 6_371_000
  const toRadians = (degrees: number) => degrees * Math.PI / 180
  const dLat = toRadians(lat2 - lat1)
  const dLng = toRadians(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function rankMtmCustomerDuplicates(
  input: MtmCustomerDuplicateInput,
  rows: MtmCustomerDuplicateRow[],
): MtmCustomerDuplicateCandidate[] {
  const inputCode = input.externalCode?.trim().toLocaleLowerCase() ?? ""
  const inputPhone = normalizeMtmPhone(input.phone)

  return rows.flatMap((row) => {
    const reasons: MtmCustomerDuplicateCandidate["reasons"] = []
    const codeMatches = Boolean(inputCode && row.code?.trim().toLocaleLowerCase() === inputCode)
    const phoneMatches = Boolean(inputPhone && normalizeMtmPhone(row.phone) === inputPhone)
    const nameScore = mtmNameSimilarity(input.name, row.name)
    const distance = input.latitude != null && input.longitude != null && row.latitude != null && row.longitude != null
      ? Math.round(distanceMeters(input.latitude, input.longitude, row.latitude, row.longitude))
      : null

    if (codeMatches) reasons.push("EXTERNAL_CODE")
    if (phoneMatches) reasons.push("PHONE")
    if (distance != null && distance <= 150) reasons.push("LOCATION")
    if (nameScore >= 0.72) reasons.push("SIMILAR_NAME")
    if (reasons.length === 0) return []

    const exact = codeMatches || phoneMatches
    const score = Math.min(100, Math.round(
      (codeMatches ? 100 : 0) +
      (phoneMatches ? 100 : 0) +
      (distance != null && distance <= 150 ? Math.max(25, 60 - distance / 4) : 0) +
      nameScore * 70,
    ))
    return [{ ...row, reasons, score, exact, distanceMeters: distance }]
  }).sort((left, right) => Number(right.exact) - Number(left.exact) || right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, 10)
}
