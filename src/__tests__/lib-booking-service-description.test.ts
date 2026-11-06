import { describe, it, expect } from "vitest"
import {
  cleanServiceDescription,
  descriptionLanguage,
  serviceDescriptionPrompt,
  SERVICE_DESCRIPTION_MAX,
} from "@/lib/booking/service-description"

/**
 * What the model answers lands in a field the owner is editing, so the test is
 * written on the answers models actually give — a preamble, quotation marks,
 * markdown, two paragraphs, three sentences too many — and not on the shape of
 * the call.
 */
describe("the description the model writes for a service", () => {
  it("drops the sentence the model puts before the text it was asked for", () => {
    expect(cleanServiceDescription('Here is a short description:\nWash and blow dry for shiny hair.'))
      .toBe("Wash and blow dry for shiny hair.")
  })

  it("keeps a colon that belongs to the description itself", () => {
    expect(cleanServiceDescription("Saçınıza qulluq: yuma, baxım və forma.")).toBe("Saçınıza qulluq: yuma, baxım və forma.")
  })

  it("unwraps the answer from quotation marks of any shape", () => {
    expect(cleanServiceDescription('"Стрижка с укладкой."')).toBe("Стрижка с укладкой.")
    expect(cleanServiceDescription("«Стрижка с укладкой.»")).toBe("Стрижка с укладкой.")
    expect(cleanServiceDescription("“Стрижка с укладкой.”")).toBe("Стрижка с укладкой.")
  })

  it("keeps quotation marks that are inside the sentence", () => {
    expect(cleanServiceDescription('Мы работаем на красках "Londa" и ухаживаем за цветом.'))
      .toBe('Мы работаем на красках "Londa" и ухаживаем за цветом.')
  })

  it("removes markdown and joins paragraphs into one line", () => {
    expect(cleanServiceDescription("**Стрижка**\n\nПодберём форму и уложим.")).toBe("Стрижка Подберём форму и уложим.")
  })

  it("cuts an over-long answer at the end of a sentence, never mid-word", () => {
    const long = `${"Красивая стрижка и укладка для вашего образа. ".repeat(12)}`
    const cleaned = cleanServiceDescription(long)
    expect(cleaned.length).toBeLessThanOrEqual(SERVICE_DESCRIPTION_MAX)
    expect(cleaned.endsWith(".")).toBe(true)
    // Nothing is invented and nothing is reordered: it is the beginning of
    // what the model said, up to a full stop.
    expect(long.startsWith(cleaned)).toBe(true)
  })

  it("marks the cut when one long sentence has no earlier full stop", () => {
    const cleaned = cleanServiceDescription(`${"слово ".repeat(120)}конец`)
    expect(cleaned.length).toBeLessThanOrEqual(SERVICE_DESCRIPTION_MAX)
    expect(cleaned.endsWith("…")).toBe(true)
    expect(cleaned).not.toContain("  ")
  })

  it("answers with nothing when the model answered with nothing", () => {
    expect(cleanServiceDescription("   \n  ")).toBe("")
  })
})

describe("what the model is asked for", () => {
  const base = {
    title: "Saç kəsimi",
    durationMinutes: 45,
    locationType: "office" as const,
    locale: "az",
  }

  it("asks for the language the CRM is in, and English for a locale we do not know", () => {
    expect(descriptionLanguage("az")).toBe("Azerbaijani")
    expect(descriptionLanguage("ru-RU")).toBe("Russian")
    expect(descriptionLanguage("tr")).toBe("English")
    expect(serviceDescriptionPrompt({ ...base, locale: "ru" })).toContain("Answer in Russian")
  })

  it("passes on what the form knows, so the text is not invented around it", () => {
    const prompt = serviceDescriptionPrompt({ ...base, category: "Saç", price: "40", currency: "AZN" })
    expect(prompt).toContain("Saç kəsimi")
    expect(prompt).toContain("45 minutes")
    expect(prompt).toContain("40 AZN")
    expect(prompt).toContain("Saç")
  })

  it("asks to rewrite, not to replace, when the owner already wrote something", () => {
    const prompt = serviceDescriptionPrompt({ ...base, current: "Стрижка машинкой, быстро" })
    expect(prompt).toContain("Rewrite the existing description")
    expect(prompt).toContain("Стрижка машинкой, быстро")
    expect(serviceDescriptionPrompt(base)).toContain("Write the description from scratch")
  })

  it("keeps the model off the facts the page shows for itself", () => {
    const prompt = serviceDescriptionPrompt(base)
    expect(prompt).toContain("Do not repeat them")
    expect(prompt).toContain("Invent nothing")
    expect(prompt).toContain(String(SERVICE_DESCRIPTION_MAX))
  })
})
