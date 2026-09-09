const AZ_OPERATOR_CODES = ["10", "50", "51", "55", "60", "70", "77", "99"]

/**
 * The nine-digit national part of an Azerbaijani mobile number, or null when
 * the digits are not one. Both the way people write it locally (0 55 ...) and
 * the international form (994 55 ...) resolve to the same national part, which
 * is what makes the two spellings comparable at all.
 */
export function azerbaijaniLocalPart(digits: string): string | null {
  const local = digits.startsWith("994")
    ? digits.slice(3)
    : digits.startsWith("0")
      ? digits.slice(1)
      : null
  if (local === null || local.length !== 9) return null
  if (!AZ_OPERATOR_CODES.includes(local.slice(0, 2))) return null
  const subscriber = local.slice(2)
  if (/^0{4,}/.test(subscriber) || /^(\d)\1{5,}$/.test(subscriber)) return null
  return local
}

export function isPlausibleLeadPhone(value: string): boolean {
  const digits = value.replace(/\D/g, "")
  if (digits.length < 10 || digits.length > 15) return false
  if (/^(\d)\1+$/.test(digits)) return false

  // A number that looks Azerbaijani must pass the national checks; anything
  // else is a foreign number and only has to be a plausible length.
  const looksAzerbaijani = digits.startsWith("994") || digits.startsWith("0")
  if (looksAzerbaijani && azerbaijaniLocalPart(digits) === null) return false

  return true
}

export function extractPhoneNumber(text: string): string | null {
  const matches = text.match(/(?:\+?\d[\d\s().-]{5,}\d)/g) ?? []
  for (const match of matches) {
    const digits = match.replace(/\D/g, "")
    if (isPlausibleLeadPhone(match)) {
      // Store one spelling. A customer writing 077 320 10 00 and the same
      // customer writing +994 77 320 10 00 are the same person, and the lead,
      // the outbound dialler and every duplicate check compare the stored
      // string — so a leading zero here becomes an unreachable lead and a
      // duplicate that nobody spots.
      // Digits only, always — including the country code, never a plus.
      //
      // The half-rule this replaces kept the plus when the customer typed one,
      // so the SAME foreign number arrived as "+4915112345678" or
      // "4915112345678" depending on how it was written, and the two never
      // matched each other. That is the very defect this function exists to
      // prevent, left in place for everyone outside Azerbaijan.
      const local = azerbaijaniLocalPart(digits)
      return local ? `994${local}` : digits
    }
  }
  return null
}

export function shouldResolveAfterPhone(platform: string, userMessage: string): boolean {
  return platform === "tiktok" && extractPhoneNumber(userMessage) !== null
}
