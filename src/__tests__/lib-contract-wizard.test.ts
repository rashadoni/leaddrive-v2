/**
 * The contract wizard's decisions (owner 2026-11-25, mock «Мастер договора по
 * ВÖEN»), on the real substituter: which fields fill themselves, what text the
 * contract gets, and — the part that can hurt — what an existing company card
 * gains. A card is only ever completed, never overwritten: its name is how
 * people find it, and a 1C pharmacy's address belongs to 1C.
 */
import { describe, it, expect } from "vitest"
import {
  STANDARD_FIELD_NAMES,
  contractAmountText,
  fillTemplate,
  requisitesBlock,
  standardValues,
  templateNamesCounterparty,
  type ContractParty,
} from "@/lib/clm/standard-fields"
import {
  BLANK,
  OUR_BANK_FROM_SETTINGS,
  companyChanges,
  defaultEndDate,
  ourSide,
  wizardText,
  type CompanyRow,
  type WizardTemplate,
} from "@/lib/clm/contract-wizard"
import { emptyBank, readBank } from "@/lib/companies/bank-requisites"

const DATE = new Date("2026-11-25T00:00:00Z")

const our: ContractParty = {
  name: "«Nümunə» MMC",
  voen: "1402578361",
  address: "Bakı, Nəsimi r., Ü. Hacıbəyov 36",
  director: "Rəşad Rəhimov",
  bank: { ...emptyBank(), bankName: "Kapital Bank", bankAccount: "AZ21AIIB38000000001944", bankCode: "200004" },
}
const kaspi: ContractParty = {
  name: "«Kaspi Logistika» MMC",
  voen: "1307137771",
  address: "Bakı, Xətai r., Babək pr. 12",
  director: "Fərid Qəhrəmanov Mahir oğlu",
  bank: { ...emptyBank(), bankName: "ABB", bankCode: "805250", bankSwift: "IBAZAZ2X", bankAccount: "AZ77IBAZ38010019441234567890" },
}

const template: WizardTemplate = {
  id: "tpl-1",
  name: "Alğı-satqı müqaviləsi",
  version: 4,
  defaultContractType: "service_agreement",
  defaultDurationMonths: 12,
  clauses: [
    { id: "c1", title: "1. Müqavilənin predmeti", body: "Satıcı {{counterparty_name}}-ə {{predmet}} təhvil verir." },
    { id: "c2", title: "2. Məbləğ", body: "Müqavilənin məbləği {{contract_amount}} {{contract_currency}}, ödəniş {{payment_days}} bank günü ərzində." },
    { id: "c3", title: "3. Təhvil", body: "Təhvil müddəti: {{delivery_term}}." },
  ],
  variables: [
    { name: "counterparty_name", type: "string", required: true },
    { name: "contract_amount", type: "string", required: true },
    { name: "contract_currency", type: "string", required: true },
    { name: "predmet", type: "string", required: true },
    { name: "payment_days", type: "number", required: true, default: 10 },
    { name: "delivery_term", type: "string", required: true },
  ],
}

describe("standard fields", () => {
  it("fill from both sides, the date and the deal's money, and leave out what has no value", () => {
    const values = standardValues({ our, counterparty: kaspi, date: DATE, amount: 48000, currency: "AZN" })
    expect(values).toMatchObject({
      our_name: "«Nümunə» MMC",
      our_iban: "AZ21AIIB38000000001944",
      counterparty_voen: "1307137771",
      counterparty_bank_swift: "IBAZAZ2X",
      contract_date: "25.11.2026",
      contract_amount: "48 000,00",
      contract_currency: "AZN",
    })
    // our side has no SWIFT: the field is absent, not "" — so a template that asks for it asks a person
    expect("our_bank_swift" in values).toBe(false)
    expect(Object.keys(values).every((k) => STANDARD_FIELD_NAMES.includes(k))).toBe(true)
  })

  it("writes sums the way AZ and RU documents do", () => {
    expect(contractAmountText(48000)).toBe("48 000,00")
    expect(contractAmountText(1234567.5)).toBe("1 234 567,50")
    expect(contractAmountText(0)).toBe("0,00")
  })

  it("asks a person only for what is neither standard nor defaulted, and keeps what they typed", () => {
    const standard = standardValues({ our, counterparty: kaspi, date: DATE, amount: 48000, currency: "AZN" })
    const fill = fillTemplate(template.variables, standard, { predmet: "Taxta palet, 400 ədəd", counterparty_name: "typed over" }, { date: DATE, amount: 48000 })
    expect(fill.values.counterparty_name).toBe("«Kaspi Logistika» MMC") // the registry's name, not a typo
    expect(fill.values.predmet).toBe("Taxta palet, 400 ədəd")
    expect(fill.missing).toEqual(["delivery_term"])
    expect(fill.asked.map((v) => v.name)).toEqual(["predmet", "payment_days", "delivery_term"])
    expect(fill.filled).toContainEqual({ name: "payment_days", source: "default" })
  })

  it("types the amount and the date as the template declares them", () => {
    const fill = fillTemplate(
      [
        { name: "contract_amount", type: "number", required: true },
        { name: "contract_date", type: "date", required: true },
      ],
      standardValues({ our, counterparty: kaspi, date: DATE, amount: 48000, currency: "AZN" }),
      {},
      { date: DATE, amount: 48000 },
    )
    expect(fill.values).toEqual({ contract_amount: 48000, contract_date: "2026-11-25" })
    expect(fill.missing).toEqual([])
  })

  it("closes the contract with both parties' requisites, one per paragraph", () => {
    const block = requisitesBlock(our, kaspi, "az")
    expect(block.split("\n\n")).toHaveLength(3)
    expect(block).toContain("TƏRƏFLƏRİN REKVİZİTLƏRİ")
    expect(block).toContain("«Kaspi Logistika» MMC\nVÖEN: 1307137771")
    expect(block).toContain("H/h: AZ77IBAZ38010019441234567890")
    // a missing field is left out, not printed as an empty label
    expect(block).not.toMatch(/SWIFT: \n|SWIFT: $/m)
    expect(requisitesBlock(our, kaspi, "ru")).toContain("РЕКВИЗИТЫ СТОРОН")
  })

  it("knows when a template already names the other side's requisites", () => {
    expect(templateNamesCounterparty([{ body: "VÖEN: {{ counterparty_voen }}" }])).toBe(true)
    expect(templateNamesCounterparty([{ body: "{{counterparty_name}} alıcıdır" }])).toBe(false)
  })
})

describe("wizardText", () => {
  const base = { our, counterparty: kaspi, date: DATE, amount: 48000, currency: "AZN", lang: "az" as const }

  it("the preview shows the whole document with a blank where a person still has to write", () => {
    const out = wizardText({ ...base, template, typed: { predmet: "Taxta palet" }, preview: true })
    if ("error" in out) throw new Error("unexpected")
    expect(out.missing).toEqual(["delivery_term"])
    expect(out.renderedBody).toContain(`Təhvil müddəti: ${BLANK}.`)
    expect(out.renderedBody).toContain("Müqavilənin məbləği 48 000,00 AZN, ödəniş 10 bank günü")
    expect(out.renderedBody.trimEnd().endsWith("AZ77IBAZ38010019441234567890")).toBe(true)
  })

  it("the contract itself is never made with a blank: without preview it names the empty field and has no text", () => {
    const out = wizardText({ ...base, template, typed: { predmet: "Taxta palet" }, preview: false })
    if ("error" in out) throw new Error("an empty field is not a broken template")
    expect(out.missing).toEqual(["delivery_term"])
    expect(out.renderedBody).toBe("")
  })

  it("a template whose text names a field it never declares is reported as broken", () => {
    const broken: WizardTemplate = { ...template, clauses: [{ id: "x", title: "X", body: "{{undeclared}}" }], variables: [] }
    expect("error" in wizardText({ ...base, template: broken, typed: {}, preview: false })).toBe(true)
  })

  it("filled in, the text has no blank and no {{markers}} left", () => {
    const out = wizardText({ ...base, template, typed: { predmet: "Taxta palet", delivery_term: "15 təqvim günü" }, preview: false })
    if ("error" in out) throw new Error("unexpected")
    expect(out.missing).toEqual([])
    expect(out.renderedBody).not.toContain(BLANK)
    expect(out.renderedBody).not.toMatch(/\{\{/)
  })

  it("does not add the requisites twice when the template writes them itself", () => {
    const own: WizardTemplate = {
      ...template,
      clauses: [{ id: "r", title: "Rekvizitlər", body: "Alıcı: {{counterparty_name}}, VÖEN {{counterparty_voen}}" }],
      variables: [
        { name: "counterparty_name", type: "string", required: true },
        { name: "counterparty_voen", type: "string", required: true },
      ],
    }
    const out = wizardText({ ...base, template: own, typed: {}, preview: false })
    if ("error" in out) throw new Error("unexpected")
    expect(out.renderedBody).not.toContain("TƏRƏFLƏRİN REKVİZİTLƏRİ")
    expect(out.renderedBody).toContain("VÖEN 1307137771")
  })

  it("a blank contract is the requisites alone, written on in the editor", () => {
    const out = wizardText({ ...base, template: null, typed: {}, preview: false })
    if ("error" in out) throw new Error("unexpected")
    expect(out.renderedBody.startsWith("TƏRƏFLƏRİN REKVİZİTLƏRİ")).toBe(true)
  })
})

describe("our side", () => {
  it("comes from the invoice settings, offers their bank first and the same account only once", () => {
    const side = ourSide(
      { companyName: "«Nümunə» MMC", companyVoen: "1402578361", companyAddress: "Bakı", directorName: "R. Rəhimov", bankName: "Kapital Bank", bankAccount: "AZ21 AIIB 3800 0000 0019 44" },
      "LeadDrive Org",
      [
        { id: "ba-same", accountName: "Main", accountNumber: "AZ21AIIB38000000001944", bankName: "Kapital Bank", bankCode: null, swiftCode: null, currency: "AZN" },
        { id: "ba-usd", accountName: "USD", accountNumber: "AZ55PAHA00000000000000", bankName: "PAŞA Bank", bankCode: "505141", swiftCode: "PAHAAZ22", currency: "USD" },
        { id: "ba-none", accountName: "Cash", accountNumber: null, bankName: "—", bankCode: null, swiftCode: null, currency: "AZN" },
      ],
    )
    expect(side.party).toEqual({ name: "«Nümunə» MMC", voen: "1402578361", address: "Bakı", director: "R. Rəhimov" })
    expect(side.banks.map((b) => b.id)).toEqual([OUR_BANK_FROM_SETTINGS, "ba-usd"])
    expect(side.banks[1].bank).toMatchObject({ bankName: "PAŞA Bank", bankSwift: "PAHAAZ22", bankAccount: "AZ55PAHA00000000000000" })
  })

  it("falls back to the organisation's name when the settings were never filled", () => {
    expect(ourSide(undefined, "LeadDrive Org", []).party).toEqual({ name: "LeadDrive Org", voen: null, address: null, director: null })
  })
})

describe("what an existing company card gains", () => {
  const card: CompanyRow = {
    id: "co-1",
    name: "Kaspi (old name people search by)",
    voen: null,
    address: "Typed by a manager",
    director: null,
    externalSource: null,
    ...emptyBank(),
  }
  const input = { voen: "1307137771", name: kaspi.name, address: kaspi.address, director: kaspi.director, bank: kaspi.bank, saveBank: true }

  it("fills only the empty fields and never renames the card", () => {
    const changes = companyChanges(card, input)
    expect(changes).toMatchObject({ voen: "1307137771", director: "Fərid Qəhrəmanov Mahir oğlu", bankAccount: "AZ77IBAZ38010019441234567890", bankSwift: "IBAZAZ2X" })
    expect("name" in changes).toBe(false)
    expect("address" in changes).toBe(false) // the manager's address stays
  })

  it("leaves the bank alone unless the person asked to save it", () => {
    const changes = companyChanges(card, { ...input, saveBank: false })
    expect(Object.keys(changes).sort()).toEqual(["director", "voen"])
  })

  it("does not touch a 1C pharmacy's address, which 1C owns", () => {
    const pharmacy = { ...card, address: null, externalSource: "zeytun_1c" }
    expect("address" in companyChanges(pharmacy, input)).toBe(false)
  })

  it("changes nothing on a card that already has it all", () => {
    const full: CompanyRow = { ...card, voen: "1307137771", director: "X", ...readBank(kaspi.bank) }
    expect(companyChanges(full, input)).toEqual({})
  })
})

describe("defaultEndDate", () => {
  it("is the day before the same date N months on, and nothing without a duration", () => {
    expect(defaultEndDate(DATE, 12)?.toISOString().slice(0, 10)).toBe("2027-11-24")
    expect(defaultEndDate(DATE, null)).toBeUndefined()
  })
})
