const AZ_MOBILE_PREFIXES = new Set(["10", "50", "51", "55", "60", "70", "77", "99"])

export interface ExtractedPhone {
  raw: string
  normalized: string
  country: "AZ"
  confidence: "high" | "medium"
}

function normalizeCandidate(raw: string): ExtractedPhone | null {
  const compact = raw.replace(/[^\d+]/g, "")
  const digits = compact.replace(/\D/g, "")

  let national = ""
  if (digits.length === 10 && digits.startsWith("0")) {
    national = digits.slice(1)
  } else if (digits.length === 12 && digits.startsWith("994")) {
    national = digits.slice(3)
  } else {
    return null
  }

  if (national.length !== 9) return null
  const operator = national.slice(0, 2)
  if (!AZ_MOBILE_PREFIXES.has(operator)) return null

  const normalized = `+994${national}`
  const hasExplicitCountry = compact.startsWith("+994") || digits.startsWith("994")
  const hasSeparators = /[\s().-]/.test(raw)
  return {
    raw: raw.trim(),
    normalized,
    country: "AZ",
    confidence: hasExplicitCountry || hasSeparators ? "high" : "medium",
  }
}

export function extractPhonesFromText(text: string): ExtractedPhone[] {
  if (!text) return []

  const matches = text.matchAll(/(?:\+?\s*994|0)(?:[\s().-]*\d){9}/g)
  const phones: ExtractedPhone[] = []
  const seen = new Set<string>()

  for (const match of matches) {
    const raw = match[0]
    const phone = normalizeCandidate(raw)
    if (!phone || seen.has(phone.normalized)) continue
    seen.add(phone.normalized)
    phones.push(phone)
  }

  return phones
}

export function extractPrimaryPhone(text: string): ExtractedPhone | null {
  return extractPhonesFromText(text)[0] ?? null
}
