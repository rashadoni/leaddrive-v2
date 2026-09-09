import { describe, it, expect } from "vitest"
import { PiiMasker, maskPii } from "@/lib/ai/pii-masker"

describe("ai/pii-masker — H9 Trust Layer", () => {
  describe("emails", () => {
    it("masks email addresses", () => {
      const m = new PiiMasker()
      expect(m.mask("Contact me at john@example.com")).toBe("Contact me at [EMAIL_1]")
    })
    it("reuses placeholder for repeated email", () => {
      const m = new PiiMasker()
      const out = m.mask("john@x.com and again john@x.com")
      expect(out).toBe("[EMAIL_1] and again [EMAIL_1]")
    })
  })

  describe("phone numbers", () => {
    it("masks international format with +", () => {
      const m = new PiiMasker()
      expect(m.mask("Call +1 415-555-0123")).toBe("Call [PHONE_1]")
    })
    it("masks parenthesized US format", () => {
      const m = new PiiMasker()
      expect(m.mask("Call (415) 555-0123")).toBe("Call [PHONE_1]")
    })
    it("masks Azerbaijani local mobile format before an inbox message reaches the model", () => {
      const m = new PiiMasker()
      expect(m.mask("Nömrəm 050 123 45 67-dir")).toBe("Nömrəm [PHONE_1]-dir")
      expect(m.unmask("Nömrəm [PHONE_1]-dir")).toBe("Nömrəm 050 123 45 67-dir")
    })
    it("masks a parenthesized Azerbaijani local mobile number accepted by lead extraction", () => {
      const m = new PiiMasker()
      expect(m.mask("Nömrəm (050) 123 45 67-dir")).toBe("Nömrəm [PHONE_1]-dir")
    })
  })

  describe("credit cards", () => {
    it("masks 16-digit cards with spaces", () => {
      const m = new PiiMasker()
      expect(m.mask("Card 4242 4242 4242 4242")).toBe("Card [CARD_1]")
    })
    it("masks with dashes", () => {
      const m = new PiiMasker()
      expect(m.mask("Card 4242-4242-4242-4242")).toBe("Card [CARD_1]")
    })
  })

  describe("IBAN", () => {
    it("masks IBAN", () => {
      const m = new PiiMasker()
      expect(m.mask("Wire to GB82 WEST 1234 5698 7654 32")).toBe("Wire to [IBAN_1]")
    })
  })

  describe("tax IDs", () => {
    it("masks INN-prefixed", () => {
      const m = new PiiMasker()
      expect(m.mask("ИНН 1234567890")).toBe("[TAXID_1]")
    })
    it("masks VOEN", () => {
      const m = new PiiMasker()
      expect(m.mask("VOEN: 1234567890")).toBe("[TAXID_1]")
    })
  })

  describe("IP addresses", () => {
    it("masks valid IPv4", () => {
      const m = new PiiMasker()
      expect(m.mask("Server at 192.168.1.100")).toBe("Server at [IP_1]")
    })
    it("does not mask invalid octets", () => {
      const m = new PiiMasker()
      // 999 > 255, so this isn't a valid IP
      expect(m.mask("Version 999.0.0.1 issue")).toContain("999.0.0.1")
    })
  })

  describe("known names and companies", () => {
    it("masks registered person names", () => {
      const m = new PiiMasker()
      m.addKnownNames(["Ivan Petrov"])
      expect(m.mask("Hi Ivan Petrov, please review")).toBe("Hi [PERSON_1], please review")
    })
    it("masks registered companies", () => {
      const m = new PiiMasker()
      m.addKnownCompanies(["Acme Corp"])
      expect(m.mask("Working with Acme Corp")).toBe("Working with [COMPANY_1]")
    })
  })

  describe("H9 additions — URL credentials", () => {
    it("masks access_token in query string", () => {
      const m = new PiiMasker()
      const out = m.mask("https://api.example.com/v1/data?access_token=abc123XYZ&format=json")
      expect(out).toBe("https://api.example.com/v1/data?access_token=[URLCRED_1]&format=json")
    })
    it("masks api_key parameter", () => {
      const m = new PiiMasker()
      const out = m.mask("https://x.com?api_key=sk-PROJ-abcdef123") // gitleaks:allow -- synthetic test/public display literal
      expect(out).toContain("[URLCRED_1]")
      expect(out).not.toContain("sk-PROJ-abcdef123")
    })
    it("masks password parameter", () => {
      const m = new PiiMasker()
      const out = m.mask("https://example.com/login?user=jane&password=hunter2&next=/home")
      expect(out).toContain("password=[URLCRED_1]")
    })
  })

  describe("H9 additions — JWT tokens", () => {
    it("masks JWT triplet", () => {
      const m = new PiiMasker()
      const jwt = "eyJhbGciOiJIUzI1NiIs.eyJzdWIiOiIxMjM0NTY3.SflKxwRJSMeKKF2Q" // gitleaks:allow -- synthetic test/public display literal
      const out = m.mask(`Bearer ${jwt}`)
      expect(out).toBe("Bearer [TOKEN_1]")
    })
  })

  describe("H9 additions — generic API keys", () => {
    it("masks Stripe live key", () => {
      const m = new PiiMasker()
      const key = "sk_live_abcdefghijklmnop1234" // gitleaks:allow -- synthetic test/public display literal
      expect(m.mask(`use ${key} for charges`)).toBe("use [TOKEN_1] for charges")
    })
    it("masks AWS access key ID", () => {
      const m = new PiiMasker()
      expect(m.mask("AKIA1234567890ABCDEF rotated")).toBe("[TOKEN_1] rotated")
    })
    it("masks GitHub PAT", () => {
      const m = new PiiMasker()
      expect(m.mask("token: ghp_abcdefghijklmnopqrstuvwxyz12")).toBe("token: [TOKEN_1]")
    })
    it("masks Slack bot token", () => {
      const m = new PiiMasker()
      expect(m.mask("xoxb-1234567890-abcdefghij is for #ops")).toBe("[TOKEN_1] is for #ops")
    })
  })

  describe("H9 additions — crypto wallets", () => {
    it("masks Ethereum address", () => {
      const m = new PiiMasker()
      expect(m.mask("Send to 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1"))
        .toBe("Send to [CRYPTO_1]")
    })
    it("masks Bitcoin Bech32 address", () => {
      const m = new PiiMasker()
      expect(m.mask("BTC: bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"))
        .toBe("BTC: [CRYPTO_1]")
    })
    it("masks Bitcoin legacy P2PKH", () => {
      const m = new PiiMasker()
      const out = m.mask("Send 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa to wallet")
      expect(out).toBe("Send [CRYPTO_1] to wallet")
    })
  })

  describe("H9 additions — SSN", () => {
    it("masks US SSN format", () => {
      const m = new PiiMasker()
      expect(m.mask("SSN: 123-45-6789")).toBe("SSN: [SSN_1]")
    })
    it("rejects invalid SSN prefixes per SSA rules", () => {
      const m = new PiiMasker()
      // 000-xx-xxxx is invalid per SSA rules → should NOT be masked
      expect(m.mask("SSN: 000-12-3456")).toContain("000-12-3456")
    })
  })

  describe("H9 additions — passports & driver licenses", () => {
    it("masks passport with explicit prefix", () => {
      const m = new PiiMasker()
      expect(m.mask("Passport: AB1234567 expires 2030")).toContain("[PASSPORT_1]")
    })
    it("masks Russian паспорт", () => {
      const m = new PiiMasker()
      expect(m.mask("паспорт 4012345678")).toContain("[PASSPORT_1]")
    })
    it("masks RU two-part passport 'паспорт 4012 345678'", () => {
      const m = new PiiMasker()
      // RU passport often written as "серия + номер" with a space: 4012 (series) + 345678 (number)
      expect(m.mask("паспорт 4012 345678 issued 2020")).toContain("[PASSPORT_1]")
    })
    it("masks driver license", () => {
      const m = new PiiMasker()
      expect(m.mask("DL: D1234567 issued 2024")).toContain("[DLIC_1]")
    })
  })

  describe("unmask round-trip", () => {
    it("restores original values", () => {
      const m = new PiiMasker()
      m.addKnownNames(["John Doe"])
      const original = "John Doe (john@example.com, +1 555-123-4567) AKIA1234567890ABCDEF"
      const masked = m.mask(original)
      const restored = m.unmask(masked)
      expect(restored).toBe(original)
      expect(masked).not.toBe(original)
      expect(m.hasMaskedData()).toBe(true)
    })
  })

  describe("stats", () => {
    it("counts items per type", () => {
      const m = new PiiMasker()
      m.mask("Two emails: a@x.com and b@y.com plus one IP 10.0.0.1")
      const stats = m.getStats()
      expect(stats.EMAIL).toBe(2)
      expect(stats.IP).toBe(1)
    })
  })

  describe("maskPii convenience", () => {
    it("returns masked text and reusable masker", () => {
      const { masked, masker } = maskPii("Email: a@b.com", undefined, undefined)
      expect(masked).toBe("Email: [EMAIL_1]")
      expect(masker.unmask(masked)).toBe("Email: a@b.com")
    })
  })

  describe("regression guards", () => {
    it("URL with credentials does not double-mask the token portion", () => {
      // access_token has a JWT-shaped value — URL credential pass runs first.
      const m = new PiiMasker()
      const jwt = "eyJhbGciOiJIUzI1NiIs.eyJzdWIiOiIxMjM0NTY3.SflKxwRJSMeKKF2Q" // gitleaks:allow -- synthetic test/public display literal
      const out = m.mask(`https://x.com/cb?access_token=${jwt}`)
      // After URL-cred pass we have [URLCRED_1]; JWT regex no longer matches placeholder.
      expect(out).toBe("https://x.com/cb?access_token=[URLCRED_1]")
    })

    it("empty input passes through", () => {
      const m = new PiiMasker()
      expect(m.mask("")).toBe("")
    })

    it("text without PII passes through unchanged", () => {
      const m = new PiiMasker()
      expect(m.mask("This is a regular sentence.")).toBe("This is a regular sentence.")
      expect(m.hasMaskedData()).toBe(false)
    })

    // Architect-flagged production blast-radius cases — IBAN regex over-match
    it("does NOT mask 'Order AB12 XY34 PQ56 returned' as IBAN", () => {
      const m = new PiiMasker()
      const out = m.mask("Order AB12 XY34 PQ56 returned")
      // Three 4-char groups is below the minimum (need 3+ AFTER the AA99 prefix)
      // Wait: AB12 fits country+2digits, then XY34 PQ56 = 2 more groups = total 3 groups.
      // Tightened regex needs 3-6 four-char groups after AB12 — only 2 here, so NO match.
      expect(out).toBe("Order AB12 XY34 PQ56 returned")
    })

    it("FedEx-style 'FX84 1234 5678 9012 GA' is KNOWN FALSE POSITIVE (TODO: MOD-97 validation)", () => {
      const m = new PiiMasker()
      const out = m.mask("FedEx FX84 1234 5678 9012 GA tracking")
      // Current behavior: regex без MOD-97 checksum validation матчит структурно похожие
      // на IBAN tracking-номера. Сценарий уязвим — например реальный FedEx tracking
      // выглядит как 12-digit number, но если кто-то напишет split-format с буквенным
      // префиксом — попадает под IBAN regex.
      // TODO H9.2: добавить MOD-97 IBAN checksum validation для убирания этого FP.
      expect(out).toContain("[IBAN_1]")
    })

    it("still masks valid GB IBAN with trailing 2-char group", () => {
      const m = new PiiMasker()
      expect(m.mask("Wire to GB82 WEST 1234 5698 7654 32")).toBe("Wire to [IBAN_1]")
    })

    it("still masks valid ES IBAN (all 4-char groups)", () => {
      const m = new PiiMasker()
      expect(m.mask("IBAN ES91 2100 0418 4502 0005 1332 paid")).toBe("IBAN [IBAN_1] paid")
    })

    // Architect-flagged: DL boundary fix
    it("does NOT mask 'EDL: 4567890 european' (no left boundary on DL)", () => {
      const m = new PiiMasker()
      const out = m.mask("EDL: 4567890 european item")
      expect(out).toContain("EDL")
      expect(out).not.toContain("[DLIC_")
    })

    it("does NOT mask 'PDL: Q12345678 project ID'", () => {
      const m = new PiiMasker()
      const out = m.mask("PDL: Q12345678 project ID")
      expect(out).not.toContain("[DLIC_")
    })

    it("still masks valid 'DL: D1234567'", () => {
      const m = new PiiMasker()
      const out = m.mask("DL: D1234567 issued 2024")
      expect(out).toContain("[DLIC_1]")
    })
  })
})
