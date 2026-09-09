import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { detectForeignNamesake } from "@/lib/social/foreign-namesake"

// Реальные тексты с прода: под «Grandmart» и «Bravo Supermarket» попадали
// магазины из Камбоджи, Сирии, Испании и США. У Grandmart релевантными были 15
// находок из 188, у Bravo — 7 из 41.
describe("зарубежные бренды-тёзки", () => {
  it("отклоняет чужую письменность", () => {
    const foreign = [
      "នំព្រិលស្រួយ ទើបចូលបងអូន មាន3រសជាតិ ❤️😻",
      "تែត្រួយធម្មជាតិ مو بس مشان اهلنا بغزة وفلسطين حتى مشانا ومشان بلدنا",
      "المقاطعة بتسلم عليكم ولا تنسو كيت كات وجالاكسي مقاطعة",
      "السبت اليوم الأوفر مع برافو مش أي سوبرماركت عروض مميزة بانتظاركم",
    ]
    for (const text of foreign) {
      expect(detectForeignNamesake(text).foreign, text.slice(0, 30)).toBe(true)
    }
  })

  it("отклоняет испанский по перевёрнутым знакам", () => {
    const verdict = detectForeignNamesake("🎉 ¡Celebramos nuestro 2.º Aniversario con más regalos para ti!")
    expect(verdict.foreign).toBe(true)
    expect(verdict.signal).toBe("spanish_punctuation")
  })

  it("НЕ трогает азербайджанский, русский и английский", () => {
    const local = [
      "Məhsul çox pisdir və dəstək cavab vermir, çatdırılma gecikdi",
      "Bakıda yeni layihə təqdim olundu, şirkət bildirib",
      "Доставка задержалась, но поддержка приняла обращение",
      "Delivery was late but the support team handled my request",
    ]
    for (const text of local) {
      expect(detectForeignNamesake(text).foreign, text.slice(0, 30)).toBe(false)
    }
  })

  it("не решает по коротким текстам и вкраплениям", () => {
    // Ложное отклонение хуже пропуска: отклонённой находки не видно вообще.
    expect(detectForeignNamesake("ok 👍").foreign).toBe(false)
    expect(detectForeignNamesake("").foreign).toBe(false)
    expect(detectForeignNamesake(null).foreign).toBe(false)
    // Одна арабская цитата внутри азербайджанского текста не делает его чужим.
    expect(detectForeignNamesake(
      "Mağazada xidmət çox pis idi, işçilər kobud davrandı və heç kim kömək etmədi — سلام",
    ).foreign).toBe(false)
  })

  it("подключён к решению о релевантности до сопоставления алиасов", () => {
    const relevance = readFileSync(
      join(process.cwd(), "src/lib/social/subject-relevance.ts"),
      "utf8",
    )
    const gate = relevance.indexOf("detectForeignNamesake(input.text)")
    const aliasMatching = relevance.indexOf("const matchedAliases = positiveAliases.filter")
    expect(gate).toBeGreaterThan(-1)
    expect(aliasMatching).toBeGreaterThan(gate)
    expect(relevance).toContain("reason: `foreign_namesake_${foreignNamesake.signal}`")
    // Ветку обсуждения не рвём: принятый потомок должен сохранить контекст.
    expect(relevance).toContain("foreignNamesake.foreign && !inheritsNegativeParent")
  })
})
