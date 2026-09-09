import { describe, expect, it } from "vitest"
import {
  approvedCompanyAddressFromKnowledge,
  approvedCompanyPhoneFromKnowledge,
  containsCompanyPhoneCandidate,
  extractCustomerPhoneNumber,
  isCompanyAddressRequest,
  isCompanyPhoneInsistence,
  isCompanyPhoneRequest,
  knowledgeWithoutApprovedCompanyContacts,
  knowledgeWithoutApprovedCompanyPhone,
  shouldResolveAfterCustomerPhone,
  withoutCompanyPhoneSentences,
} from "@/lib/inbox/company-phone-policy"

describe("approved company phone policy", () => {
  it("trusts only a valid explicitly marked Knowledge Base phone", () => {
    expect(approvedCompanyPhoneFromKnowledge(
      "Məhsul məlumatı\nAPPROVED_COMPANY_PHONE: 0507778555\nBaşqa məlumat",
    )).toBe("0507778555")
    expect(approvedCompanyPhoneFromKnowledge("Telefon: +994 50 209 09 99")).toBeNull()
    expect(approvedCompanyPhoneFromKnowledge("APPROVED_COMPANY_PHONE: call 0507778555")).toBeNull()
    expect(approvedCompanyPhoneFromKnowledge(
      "APPROVED_COMPANY_PHONE: 0507778555\nAPPROVED_COMPANY_PHONE: 0501112233",
    )).toBeNull()
  })

  it("removes the private control marker before model context is composed", () => {
    expect(knowledgeWithoutApprovedCompanyPhone(
      "Məhsul məlumatı\nAPPROVED_COMPANY_PHONE: 0507778555\nÇatdırılma məlumatı",
    )).toBe("Məhsul məlumatı\nÇatdırılma məlumatı")
  })

  it("reads one approved address and hides all approved contacts from model context", () => {
    const knowledge = [
      "Məhsul məlumatı",
      "APPROVED_COMPANY_PHONE: 0507778555",
      "APPROVED_COMPANY_ADDRESS: Bakı şəhəri, Qaradağ rayonu, Səngəçal qəsəbəsi, Salyan şossesi, 47-ci kilometr",
    ].join("\n")
    expect(approvedCompanyAddressFromKnowledge(knowledge)).toBe(
      "Bakı şəhəri, Qaradağ rayonu, Səngəçal qəsəbəsi, Salyan şossesi, 47-ci kilometr",
    )
    expect(knowledgeWithoutApprovedCompanyContacts(knowledge)).toBe("Məhsul məlumatı")
    expect(approvedCompanyAddressFromKnowledge(
      `${knowledge}\nAPPROVED_COMPANY_ADDRESS: Başqa ünvan`,
    )).toBeNull()
  })

  it.each([
    "Sizin nömrənizi verin",
    "Hansı nömrəyə zəng edim?",
    "Дайте ваш номер телефона",
    "Как вам позвонить?",
    "What number can I call?",
  ])("recognizes a company-phone request: %s", (text) => {
    expect(isCompanyPhoneRequest(text)).toBe(true)
  })

  it.each([
    "Harada yerləşirsiniz?",
    "Haradasınız?",
    "Ünvanınızı yazın",
    "Где вы находитесь?",
    "Где вы?",
    "Где находится магазин?",
    "Можно адрес?",
    "Какой у вас адрес?",
    "Where are you located?",
    "Where is the store?",
  ])("recognizes a company-address request: %s", (text) => {
    expect(isCompanyAddressRequest(text)).toBe(true)
  })

  it("treats a contextual 'what about yours?' as a request only after customer intake", () => {
    expect(isCompanyPhoneRequest("Bəs sizin?")).toBe(false)
    expect(isCompanyPhoneRequest("Bəs sizin?", { customerPhoneWasRequested: true })).toBe(true)
  })

  it("recognizes explicit insistence", () => {
    expect(isCompanyPhoneInsistence("Mən israr edirəm, məhz sizin nömrənizi istəyirəm")).toBe(true)
    expect(isCompanyPhoneInsistence("Я настаиваю, дайте ваш номер")).toBe(true)
  })

  it("does not confuse document numbers with the company phone", () => {
    expect(isCompanyPhoneRequest("Дайте ваш номер заказа")).toBe(false)
    expect(isCompanyPhoneRequest("Пришлите ваш номер договора")).toBe(false)
  })

  it("keeps a customer's phone in a mixed message but rejects a claimed company phone", () => {
    expect(extractCustomerPhoneNumber("Мой номер 050 111 22 33, а ваш?")).toBe("994501112233")
    expect(isCompanyPhoneRequest("Мой номер 050 111 22 33, а ваш?")).toBe(true)
    expect(extractCustomerPhoneNumber(
      "Это ваш +994 50 209 09 99? Мой номер 050 111 22 33",
    )).toBe("994501112233")
    expect(extractCustomerPhoneNumber("Это ваш номер +994 50 209 09 99?")).toBeNull()
    expect(shouldResolveAfterCustomerPhone("tiktok", "Это ваш номер +994 50 209 09 99?")).toBe(false)
  })

  it("removes a hallucinated phone sentence but preserves useful text", () => {
    const reply = "Məlumat saytdadır. Zəng: +994 50 209 09 99."
    expect(containsCompanyPhoneCandidate(reply)).toBe(true)
    expect(withoutCompanyPhoneSentences(reply)).toBe("Məlumat saytdadır.")
    expect(withoutCompanyPhoneSentences("Məlumat saytdadır. Zəng: 050.209.09.99.")).toBe("Məlumat saytdadır.")
    expect(withoutCompanyPhoneSentences("Məlumat saytdadır. Zəng: 050/209-09-99.")).toBe("Məlumat saytdadır.")
    expect(containsCompanyPhoneCandidate("Call +14155552671")).toBe(true)
  })
})
