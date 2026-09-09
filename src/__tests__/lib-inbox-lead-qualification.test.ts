import { describe, expect, it } from "vitest"
import {
  extractPhoneNumber,
  isCommercialCandidate,
  qualificationDueDate,
  qualificationChecklist,
  QUALIFICATION_CHECKLIST,
  QUALIFICATION_CUSTOMER_STATUSES,
} from "@/lib/inbox/lead-qualification"

describe("inbox AI lead qualification — pure guards", () => {
  it("requires a plausible 7-15 digit phone and normalizes separators", () => {
    expect(extractPhoneNumber("Qiymət nədir? +994 50 123 45 67")).toBe("994501234567")
    expect(extractPhoneNumber("номер: (050) 123-45-67")).toBe("994501234567")
    expect(extractPhoneNumber("ölçü 42 varmı?")).toBeNull()
  })

  it("treats delivery, bringing and ordering questions as commercial interest", () => {
    for (const message of [
      "Daşı verimə gətirirsiniz?",
      "Çatdırılma edirsiniz?",
      "Доставляете по адресу?",
      "Привезёте по адресу?",
      "Do you deliver?",
      "Can you bring it to my address?",
      "Sifariş vermək istəyirəm",
    ]) {
      expect(isCommercialCandidate(message), message).toBe(true)
    }
    expect(isCommercialCandidate("Salam")).toBe(false)
  })

  it("does not treat an after-sales delivery complaint as a new commercial lead", () => {
    for (const message of [
      "Çatdırılma gecikib",
      "Доставка задерживается",
      "My delivery is late",
    ]) {
      expect(isCommercialCandidate(message), message).toBe(false)
    }
    expect(isCommercialCandidate("Do you deliver chocolate?")).toBe(true)
    expect(isCommercialCandidate("Latest delivery options")).toBe(true)
    expect(isCommercialCandidate("Daşı gətirmədiniz")).toBe(false)
    expect(isCommercialCandidate("Заказ не привезли")).toBe(false)
    expect(isCommercialCandidate("Where is my order?")).toBe(false)
    expect(isCommercialCandidate("Where's my order?")).toBe(false)
    expect(isCommercialCandidate("My order never arrived")).toBe(false)
    expect(isCommercialCandidate("Где мой заказ?")).toBe(false)
    expect(isCommercialCandidate("Sifarişim haradadır?")).toBe(false)
  })

  it("uses a 24-hour weekday SLA and a 72-hour weekend SLA in the org timezone", () => {
    const fridayInBaku = new Date("2026-07-24T08:00:00.000Z")
    const saturdayInBaku = new Date("2026-07-25T08:00:00.000Z")
    expect(qualificationDueDate(fridayInBaku, "Asia/Baku").getTime() - fridayInBaku.getTime()).toBe(24 * 60 * 60 * 1000)
    expect(qualificationDueDate(saturdayInBaku, "Asia/Baku").getTime() - saturdayInBaku.getTime()).toBe(72 * 60 * 60 * 1000)
  })

  it("creates the exact three required checklist steps", () => {
    expect(QUALIFICATION_CHECKLIST).toEqual([
      "Əlaqə saxlanılsın",
      "Müştərinin yazışmasının qısa xülasəsi qeyd olunsun",
      "Nəticəni bölüş",
    ])
  })

  it("provides editable customer lifecycle statuses", () => {
    expect(QUALIFICATION_CUSTOMER_STATUSES).toEqual([
      "Maraqlanan izləyici",
      "Potensial izləyici",
      "Marketinq əlaqə saxladı",
      "Satış əlaqə saxladı",
      "Satış əlaqə saxlaya bilmədi",
      "Satıldı",
      "Satılmadı",
      "Nəticəsiz",
    ])
  })

  it("adds the customer's exact interest and category guidance for the seller", () => {
    expect(qualificationChecklist("size", "Müştəri 42 ölçünün olub-olmadığını soruşur")).toEqual([
      ...QUALIFICATION_CHECKLIST,
      "Müştərinin əsas marağı: Müştəri 42 ölçünün olub-olmadığını soruşur",
      "Satıcı üçün təklif: Modeli və istifadə məqsədini dəqiqləşdirin; uyğun ölçünü və mövcudluğu təklif edin.",
    ])
  })

  it("uses a tailored AI pitch when one was generated", () => {
    expect(qualificationChecklist(
      "credit",
      "Müştəri 12 aylıq taksitlə 55 düymlük televizor axtarır",
      "12 aylıq plan üçün ilkin ödənişi dəqiqləşdirin və uyğun 55 düymlük modelləri müqayisə edin.",
    )).toEqual([
      ...QUALIFICATION_CHECKLIST,
      "Müştərinin əsas marağı: Müştəri 12 aylıq taksitlə 55 düymlük televizor axtarır",
      "Satıcı üçün təklif: 12 aylıq plan üçün ilkin ödənişi dəqiqləşdirin və uyğun 55 düymlük modelləri müqayisə edin.",
    ])
  })
})
