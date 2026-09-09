/**
 * PII Masker — masks personal data before sending to LLM, restores in response.
 *
 * Detects and masks:
 * - Email addresses → [EMAIL_1]
 * - Phone numbers → [PHONE_1]
 * - Credit card numbers → [CARD_1]
 * - IBAN / bank accounts → [IBAN_1]
 * - IP addresses → [IP_1]
 * - Tax IDs (INN/VOEN/NIP) → [TAXID_1]
 * - SSN (US Social Security Numbers) → [SSN_1]
 * - Passport numbers (RU/AZ/generic) → [PASSPORT_1]
 * - JWT / API key tokens → [TOKEN_1]
 * - Crypto wallet addresses (BTC/ETH) → [CRYPTO_1]
 * - URL credentials (access_token, api_key params) → [URLCRED_1]
 * - Driver license patterns → [DLIC_1]
 * - Known names (from CRM context) → [PERSON_1]
 * - Known company names → [COMPANY_1]
 *
 * Usage:
 *   const masker = new PiiMasker()
 *   masker.addKnownNames(["Ivan Petrov", "Sarah Johnson"])
 *   masker.addKnownCompanies(["Acme Corp", "MegaSoft"])
 *   const masked = masker.mask("Contact Ivan Petrov at ivan@company.com")
 *   // → "Contact [PERSON_1] at [EMAIL_1]"
 *
 * Part of H9 Trust Layer (Phase 1 roadmap).
 */

interface MaskEntry {
  placeholder: string
  original: string
}

export class PiiMasker {
  private masks: MaskEntry[] = []
  private counters: Record<string, number> = {}
  private knownNames: string[] = []
  private knownCompanies: string[] = []

  private getPlaceholder(type: string): string {
    this.counters[type] = (this.counters[type] || 0) + 1
    return `[${type}_${this.counters[type]}]`
  }

  private addMask(type: string, original: string): string {
    const existing = this.masks.find(m => m.original === original)
    if (existing) return existing.placeholder
    const placeholder = this.getPlaceholder(type)
    this.masks.push({ placeholder, original })
    return placeholder
  }

  /**
   * Register known person names from CRM data (contacts, leads).
   * These will be masked even though regex can't detect arbitrary names.
   */
  addKnownNames(names: string[]) {
    for (const name of names) {
      if (name && name.trim().length > 1) {
        this.knownNames.push(name.trim())
      }
    }
    // Sort longest first to avoid partial matches
    this.knownNames.sort((a, b) => b.length - a.length)
  }

  /**
   * Register known company names from CRM data.
   */
  addKnownCompanies(companies: string[]) {
    for (const name of companies) {
      if (name && name.trim().length > 1) {
        this.knownCompanies.push(name.trim())
      }
    }
    this.knownCompanies.sort((a, b) => b.length - a.length)
  }

  /**
   * Mask PII in text. Call before sending to LLM.
   */
  mask(text: string): string {
    if (!text) return text
    let result = text

    // 1. Known company names (before emails, since company names can contain dots)
    for (const company of this.knownCompanies) {
      if (result.includes(company)) {
        const placeholder = this.addMask("COMPANY", company)
        result = result.split(company).join(placeholder)
      }
    }

    // 2. Known person names
    for (const name of this.knownNames) {
      if (result.includes(name)) {
        const placeholder = this.addMask("PERSON", name)
        result = result.split(name).join(placeholder)
      }
    }

    // 3. Email addresses
    result = result.replace(
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
      (match) => this.addMask("EMAIL", match)
    )

    // 4. Phone numbers. Azerbaijani customers commonly send a national mobile
    // number without +994 (for example 050 123 45 67). The lead extractor
    // accepts it, so the privacy boundary must mask the same format before the
    // conversation is sent to an external model.
    result = result.replace(
      /(^|[^\d])(\(?0(?:10|50|51|55|60|70|77|99)\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2})(?!\d)/g,
      (_match, lead, phone) => `${lead}${this.addMask("PHONE", phone)}`,
    )

    // International numbers must start with + or have another clear format.
    result = result.replace(
      /\+\d{1,3}[\s.-]?\(?\d{2,4}\)?[\s.-]?\d{2,4}[\s.-]?\d{2,4}(?:[\s.-]?\d{2,4})?/g,
      (match) => {
        const digits = match.replace(/\D/g, "")
        if (digits.length >= 7 && digits.length <= 15) {
          return this.addMask("PHONE", match)
        }
        return match
      }
    )
    // Also match parenthesized format: (555) 123-4567
    result = result.replace(
      /\(\d{3}\)\s?\d{3}[\s.-]?\d{4}/g,
      (match) => this.addMask("PHONE", match)
    )

    // 5. IBAN (BEFORE credit card) — country (2 letters) + 2 check digits +
    //    3-6 full 4-char groups, with at most one trailing 2-3 char group.
    //    Must run before CARD regex, иначе 4 средние группы IBAN ловятся как card.
    //    Tightened to avoid catching "Order AB12 XY34 PQ56 returned" as IBAN.
    //    Note: regex doesn't validate MOD-97 checksum.
    result = result.replace(
      /\b[A-Z]{2}\d{2}(?:\s?[\dA-Z]{4}){3,6}(?:\s?[\dA-Z]{2,3})?\b/g,
      (match) => this.addMask("IBAN", match)
    )

    // 6. Credit card numbers (4 groups of 4 digits) — runs AFTER IBAN
    result = result.replace(
      /\b\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{4}\b/g,
      (match) => this.addMask("CARD", match)
    )

    // 7. Tax IDs — \b doesn't behave well with Cyrillic, use explicit boundaries
    result = result.replace(
      /(^|[\s.,;:!?(\[])(ИНН|INN|VOEN|VÖEN|NIP|TIN|EIN)[\s.:№#]*(\d{10,12})(?=$|[\s.,;:!?)\]])/gi,
      (_match, lead, _label, digits) => `${lead}${this.addMask("TAXID", `${_label} ${digits}`)}`
    )

    // 8. IP addresses (IPv4)
    result = result.replace(
      /\b(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
      (match) => this.addMask("IP", match)
    )

    // 9. URL credentials (access_token, api_key, password, secret в query string)
    //    Маскируется до проверки JWT/токенов, иначе URL credential matches token regex first.
    result = result.replace(
      /(\?|&)(access_token|api_key|apikey|auth|token|password|secret|client_secret)=([^&\s"'<>]+)/gi,
      (_match, sep, key, value) => `${sep}${key}=${this.addMask("URLCRED", value)}`
    )

    // 10. JWT tokens (header.payload.signature — three base64url segments)
    result = result.replace(
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
      (match) => this.addMask("TOKEN", match)
    )

    // 11. Generic API key patterns (sk_live_, pk_test_, AKIA, ghp_, xoxb-, Bearer-prefixed)
    result = result.replace(
      /\b(sk_(?:live|test)_[A-Za-z0-9]{16,}|pk_(?:live|test)_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[A-Za-z0-9_-]{30,})\b/g,
      (match) => this.addMask("TOKEN", match)
    )

    // 12. Bitcoin addresses (Legacy P2PKH, P2SH, Bech32)
    result = result.replace(
      /\b(?:[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-z0-9]{25,62})\b/g,
      (match) => {
        // Avoid false positives — bitcoin Legacy looks like generic alphanumeric.
        // Use Base58 character set check: must contain mixed case + digits, not all lowercase.
        const looksLikeBtc = /[A-Z]/.test(match) && /[a-z]/.test(match) && /\d/.test(match)
        const looksLikeBech32 = match.startsWith("bc1")
        if (looksLikeBtc || looksLikeBech32) return this.addMask("CRYPTO", match)
        return match
      }
    )

    // 13. Ethereum addresses
    result = result.replace(
      /\b0x[a-fA-F0-9]{40}\b/g,
      (match) => this.addMask("CRYPTO", match)
    )

    // 14. SSN (US Social Security Number, format XXX-XX-XXXX)
    result = result.replace(
      /\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g,
      (match) => this.addMask("SSN", match)
    )

    // 15. Passports — prefix-anchored, letter prefix optional (RU passport is digits-only).
    //    Supports RU two-part series+number: "паспорт 4012 345678" / "паспорт 40 12 345678"
    //    Matches: "passport: AB1234567", "паспорт 4012345678", "passport no. P12345678"
    result = result.replace(
      /(passport|паспорт|passeport|pasaport)[\s.:№#]*([A-ZА-Я]{0,3}\s?\d{2,4}\s?\d{0,4}\s?\d{0,8})(?=$|[\s.,;:!?)\]])/gi,
      (_match, label, ref) => {
        // Sanity: total digits 6-12
        const digits = ref.replace(/\D/g, "")
        if (digits.length < 6 || digits.length > 12) return _match
        return this.addMask("PASSPORT", `${label} ${ref}`.trim())
      }
    )

    // 16. Driver license — left boundary added (was over-matching "PDL", "EDL", "DL number is")
    result = result.replace(
      /(^|[\s.,;:(\[])(DL|driver['\s]*licen[cs]e|водительск[оа]е)[\s.:№#]+([A-Z0-9]{6,15})(?=$|[\s.,;:!?)\]])/gi,
      (_match, lead, label, num) => `${lead}${this.addMask("DLIC", `${label} ${num}`)}`
    )

    return result
  }

  /**
   * Restore original values in LLM response.
   */
  unmask(text: string): string {
    if (!text) return text
    let result = text
    const sorted = [...this.masks].sort((a, b) => b.placeholder.length - a.placeholder.length)
    for (const { placeholder, original } of sorted) {
      result = result.split(placeholder).join(original)
    }
    return result
  }

  /** Get count of masked items by type. */
  getStats(): Record<string, number> {
    return { ...this.counters }
  }

  /** Check if any PII was detected. */
  hasMaskedData(): boolean {
    return this.masks.length > 0
  }
}

/**
 * Convenience: mask text with known CRM names.
 */
export function maskPii(text: string, knownNames?: string[], knownCompanies?: string[]): { masked: string; masker: PiiMasker } {
  const masker = new PiiMasker()
  if (knownNames) masker.addKnownNames(knownNames)
  if (knownCompanies) masker.addKnownCompanies(knownCompanies)
  const masked = masker.mask(text)
  return { masked, masker }
}
