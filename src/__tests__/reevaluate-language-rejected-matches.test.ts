import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const script = readFileSync(
  join(process.cwd(), "scripts/reevaluate-language-rejected-matches.ts"),
  "utf8",
)

describe("reevaluate-language-rejected-matches", () => {
  // Скрипт пишет по проду, поэтому случайный запуск обязан быть безвредным.
  it("dry-run по умолчанию, запись только по --apply", () => {
    expect(script).toContain('const hasFlag = (name: string) => process.argv.includes(`--${name}`)')
    expect(script).toContain('const apply = hasFlag("apply")')
    // Единственная запись обязана стоять под флагом.
    expect(script).toMatch(/if \(apply\) \{\s*\n\s*await persistSubjectMatches/)
    expect(script).toContain("Dry-run — ДЕФОЛТ")
  })

  // Главное свойство: правила релевантности не дублируются. Копия разъедется с
  // боевой логикой, и пересчёт начнёт выдавать вердикты, которых приём не даёт.
  it("зовёт боевую оценку и боевую запись, а не свои правила", () => {
    expect(script).toContain('import { evaluateSubjectRelevance, persistSubjectMatches } from "../src/lib/social/subject-relevance"')
    // Вход собирается из строки функцией toIngestInput и уходит в боевую
    // оценку; своих правил у скрипта нет.
    expect(script).toMatch(/await evaluateSubjectRelevance\(\{?\s*\n?\s*\.{0,3}toIngestInput\(row\)/)
    expect(script).toContain("await persistSubjectMatches(")
    // Признаки самодельного матчинга: их тут быть не должно.
    expect(script).not.toContain("matchedAliasIds:")
    expect(script).not.toMatch(/status:\s*"MATCHED"/)
  })

  // Боевой код ходит через общий prisma под RLS: без контекста запросы тихо
  // вернут 0 строк, и скрипт «успешно» ничего не сделает.
  it("оборачивает всё в RLS-контекст", () => {
    expect(script).toContain('import { runWithRlsBypass } from "../src/lib/rls-context"')
    expect(script).toContain("runWithRlsBypass(() => main())")
    expect(script).toContain('import { makeScriptPrisma } from "./_rls.mjs"')
  })

  // Провенанс Google Alerts живёт только в рантайме сбора. Без него
  // неоднозначный алиас теряет второй сигнал и был бы отклонён ошибочно.
  it("пропускает находки, которым нужен невосстановимый провенанс", () => {
    expect(script).toContain("PROVENANCE_DEPENDENT_PROVIDERS")
    expect(script).toContain('"google_alerts"')
    expect(script).toMatch(/PROVENANCE_DEPENDENT_PROVIDERS\.has\(provider\)/)
  })

  // Выборка обязана быть узкой: пересчитываем только то, что отклонил языковой
  // гейт, и только живые находки.
  it("берёт только отклонённых языковым гейтом и непокрытые находки", () => {
    expect(script).toContain('const REJECT_REASON = "subject_language_mismatch"')
    expect(script).toContain("msm.status = 'REJECTED'")
    expect(script).toContain('sm."purgedAt" IS NULL')
  })
})

describe("режим --scope=matched", () => {
  // Пересчёт уже принятых нужен после изменения правил отбора: пометка родовых
  // алиасов неоднозначными (#664) отсекает новых тёзок, но принятые раньше
  // остаются принятыми, пока их не пересчитают.
  it("умеет пересчитывать принятые, а не только отклонённых по языку", () => {
    expect(script).toContain('const scope = (arg("scope") ?? "language-rejected").trim()')
    expect(script).toContain(`msm.status = 'MATCHED'`)
    expect(script).toContain("unknown_scope_")
  })

  // Ручное решение оператора авторитетнее автоматики: persistSubjectMatches его
  // и так бережёт, но выбирать такие строки на пересчёт незачем.
  it("не трогает ручные решения оператора", () => {
    expect(script).toContain(`msm.reason <> 'operator_review_accept'`)
  })
})

describe("комментарии в режиме matched", () => {
  // Комментарий получает релевантность от родительского поста, а не от своего
  // текста. Родительский контекст из строки не восстановить, поэтому пересчёт
  // дал бы ложный no_monitoring_subject_match — на проде это 109 местных
  // комментариев, включая жалобы на товар.
  it("пропускает комментарии, чья релевантность держится на родителе", () => {
    expect(script).toContain("PARENT_CONTEXT_KINDS")
    expect(script).toContain('"COMMENT"')
    expect(script).toContain('"REPLY"')
    expect(script).toMatch(/scope === "matched" && PARENT_CONTEXT_KINDS\.has\(kind\)/)
  })
})

describe("область --scope=ambiguous-alias (судья вторым признаком)", () => {
  // Судья — сетевой вызов: без ключа область просто не запускается, чтобы
  // прогон не отрапортовал «ноль изменений» вместо «нечем судить».
  it("требует ключ провайдера, а не молчит без него", () => {
    expect(script).toContain('const judgeScope = scope === "ambiguous-alias"')
    expect(script).toContain("ambiguous-alias scope requires ANTHROPIC_API_KEY")
  })

  // Ключевое свойство: проход меняет решения ТОЛЬКО в одну сторону. На «не про
  // нас» и «не уверен» строка не трогается, поэтому судья не может отнять
  // находку ни у правил, ни у оператора.
  it("пересчитывает только подтверждённые судьёй", () => {
    expect(script).toMatch(/if \(!confirmed\) continue/)
    expect(script).toContain('const AMBIGUOUS_ALIAS_REASON = "ambiguous_alias_requires_second_signal"')
    // Вердикт адресный: передаётся под тем объектом, по которому вынесен отказ.
    expect(script).toMatch(/verdicts: \{ \[row\.subjectId as string\]: "about_subject" \}/)
  })

  // Версия судьи едет вместе с вердиктом: иначе нельзя отличить находки,
  // которые держатся на слове конкретной версии.
  it("ставит версию судьи в вердикт", () => {
    expect(script).toContain("version: AI_RELEVANCE_JUDGE_VERSION")
  })
})
