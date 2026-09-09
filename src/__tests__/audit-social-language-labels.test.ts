import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const script = readFileSync(
  join(process.cwd(), "scripts/audit-social-language-labels.ts"),
  "utf8",
)

describe("audit-social-language-labels", () => {
  // Диагностика по проду обязана быть безопасной при случайном запуске: у неё
  // нет `--apply`, потому что писать ей нечего. Если сюда однажды добавят
  // запись, тест должен упасть раньше, чем скрипт доедет до продовой базы.
  it("только читает: ни записи, ни флага --apply", () => {
    expect(script).not.toContain("--apply")
    expect(script).not.toMatch(/\$executeRaw/)
    expect(script).not.toMatch(/\bprisma\.\w+\.(update|updateMany|create|createMany|delete|deleteMany|upsert)\b/)
    expect(script).not.toMatch(/\b(UPDATE|INSERT|DELETE)\b\s+(FROM\s+)?(social_|monitoring_|ingest_)/i)
  })

  // Детектор не должен дублироваться: расхождение копии с боевой функцией
  // сделает замер бессмысленным ровно тогда, когда он нужнее всего.
  it("берёт боевой детектор, а не копию правил", () => {
    expect(script).toContain('import { detectArticleLanguage } from "../src/lib/social/article-language"')
    expect(script).toContain("detectArticleLanguage(")
    // Копипаста словарей боевого детектора — признак разъезжающегося дубля.
    expect(script).not.toContain("AZ_WORDS")
    expect(script).not.toContain("EN_WORDS")
  })

  // Скрипт ходит в прод, значит обязан идти через RLS-обёртку, а не поднимать
  // собственный PrismaClient (см. CLAUDE.md про fail-closed RLS).
  it("подключается через RLS-обёртку для скриптов", () => {
    expect(script).toContain('import { makeScriptPrisma } from "./_rls.mjs"')
    expect(script).not.toContain("new PrismaClient(")
  })

  // Метрики, ради которых скрипт написан. Если их вынут, замер перестанет
  // отвечать на вопрос «где разметка шаткая».
  it("меряет слепую зону гейта, класс az/tr и длину текста", () => {
    expect(script).toContain("subject_language_mismatch")
    expect(script).toContain("без метки")
    expect(script).toContain("AZ_UNIQUE")
    expect(script).toContain("AZ_SHARED_WITH_TURKISH")
    expect(script).toContain("FB_CHROME")
  })
})
