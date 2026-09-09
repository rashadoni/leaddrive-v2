import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const script = readFileSync(
  join(process.cwd(), "scripts/backfill-social-mention-language.ts"),
  "utf8",
)

// Бэкфилл пишет по живому проду, поэтому его границы важнее его удобства.
describe("бэкфилл языка находок", () => {
  it("по умолчанию ничего не пишет — запись требует явного --apply", () => {
    expect(script).toContain('const apply = hasFlag("apply")')
    // Единственная запись в скрипте обязана быть под флагом.
    const writeIndex = script.indexOf("prisma.socialMention.update")
    expect(writeIndex).toBeGreaterThan(-1)
    expect(script.slice(0, writeIndex)).toContain("if (apply) {")
    expect(script).toContain("DRY-RUN (ничего не записано)")
  })

  it("определяет язык боевым детектором, а не собственными правилами", () => {
    expect(script).toContain('from "../src/lib/social/article-language"')
    expect(script).toContain("detectArticleLanguage(mention.text)")
    // Никаких локальных языковых эвристик: расхождение с инжестом недопустимо.
    expect(script).not.toMatch(/CYRILLIC|AZ_WORDS|\[а-яА-Я/)
  })

  it("не перезаписывает уже проставленный язык и молчит при неуверенности", () => {
    expect(script).toContain('typeof socialTriage.language === "string"')
    expect(script).toContain("alreadySet += 1")
    expect(script).toContain("if (!detected) {")
    expect(script).toContain('languageSource: "heuristic"')
  })

  it("трогает только языковое поле — статусы и очередь авто-ревью не затрагивает", () => {
    expect(script).not.toMatch(/status:\s*["']/)
    expect(script).not.toContain("relevanceStatus")
    expect(script).not.toContain("ingestEnvelope")
    expect(script).not.toContain("deleteMany")
    expect(script).not.toContain("updateMany")
  })

  it("идёт через RLS-обёртку для скриптов", () => {
    expect(script).toContain("makeScriptPrisma")
    expect(script).toContain('from "./_rls.mjs"')
  })
})
