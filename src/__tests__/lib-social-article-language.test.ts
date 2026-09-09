import { describe, expect, it } from "vitest"
import { detectArticleLanguage } from "@/lib/social/article-language"

// Детектор обязан быть согласован с SQL-эвристикой бэкфилла
// (prisma/migrations/20260731191000_web_mentions_language_backfill).
describe("detectArticleLanguage", () => {
  it("detects Azerbaijani by the unique ə letter", () => {
    expect(detectArticleLanguage("Bakıda yeni layihə təqdim olundu")).toBe("az")
  })

  it("detects Azerbaijani by frequent function words", () => {
    expect(detectArticleLanguage("Bank ili ilə bağlı hesabat yaydı")).toBe("az")
  })

  it("detects Azerbaijani by ğ/ı/ş diacritics without ə", () => {
    expect(detectArticleLanguage("Yeni kampaniya başladı")).toBe("az")
  })

  it("detects Russian by cyrillic before any other signal", () => {
    expect(detectArticleLanguage("Компания представила новый проект в Баку")).toBe("ru")
  })

  it("detects English by frequent function words", () => {
    expect(detectArticleLanguage("The company has announced a new project")).toBe("en")
  })

  it("returns null for undetectable or empty text", () => {
    expect(detectArticleLanguage("12345 !!!")).toBeNull()
    expect(detectArticleLanguage("")).toBeNull()
    expect(detectArticleLanguage(null)).toBeNull()
    expect(detectArticleLanguage(undefined)).toBeNull()
  })

  it("does not mislabel diacritic-free Azerbaijani as az (honest unknown)", () => {
    // «ve/ucun» без диакритик не совпадают со словарём — лучше «неизвестно»,
    // чем ложная метка: такие находки видны под фильтром «bütün dillər».
    expect(detectArticleLanguage("Sirket ucun yeni xidmet kampaniyasi")).toBeNull()
  })
})
