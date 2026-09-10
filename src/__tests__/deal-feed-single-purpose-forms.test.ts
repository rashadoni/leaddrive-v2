import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * На вкладке «Лента» стояли две формы, и владелец спросил, чем они
 * отличаются. Ответ был неприятный: почти ничем — и одновременно очень
 * многим.
 *
 * Верхняя панель вкладкой «Заметка» слала ровно тот же
 * `POST /api/v1/activities` с `type: "note"`, что и форма ниже, только без
 * поля описания. А вторая её вкладка называлась «Email» — как и тип в нижней
 * форме, — но отправляла настоящее письмо клиенту через SMTP, тогда как
 * нижняя лишь ставит отметку «письмо было». Одно слово на действие и на
 * запись о действии: перепутать можно было в обе стороны.
 */
const bar = readFileSync("src/components/deals/quick-action-bar.tsx", "utf8")
const timeline = readFileSync("src/components/deals/activity-timeline.tsx", "utf8")
const page = readFileSync("src/app/(dashboard)/deals/[id]/page.tsx", "utf8")

describe("the top bar only acts, the feed form only records", () => {
  it("drops the duplicate note tab from the action bar", () => {
    expect(bar).not.toContain('type ActionType')
    expect(bar).not.toContain("activeType")
    // Заметка писалась туда же, куда пишет форма ленты. Проверяем сам вызов,
    // а не слово: комментарий выше в файле цитирует прежнее поведение, и
    // терять это объяснение ради текстового совпадения не нужно.
    expect(bar).not.toContain('fetch("/api/v1/activities"')
    expect(bar).toContain("/send-email")
  })

  it("names the remaining action with a verb, not with a type", () => {
    // «Email» стояло и на кнопке отправки, и на типе записи в журнале.
    expect(page).toContain('email: tc("sendEmailAction")')
    expect(page).not.toContain('tc("actTypeEmail")')
  })

  it("says out loud that the feed form is a log", () => {
    expect(timeline).toContain('tc("actLogEntry")')
  })
})

describe("the feed form no longer pretends to create tasks", () => {
  it("offers four real activity types", () => {
    expect(timeline).toContain('const ACTIVITY_TYPES = ["call", "email", "meeting", "note"] as const')
  })

  it("still renders and filters task rows already in the database", () => {
    // Записи этого типа уже созданы — спрятать их значило бы потерять историю.
    expect(timeline).toContain('const filters = ["all", "call", "email", "meeting", "note", "task"]')
    expect(timeline).toMatch(/task: \{ icon: CheckSquare/)
  })

  it("wraps the type row so the last button cannot leave the card", () => {
    // Пятая кнопка обрезалась правым краем карточки.
    expect(timeline).toContain('<div className="flex flex-wrap gap-1.5">')
  })
})

describe("no orphaned label is left behind", () => {
  it("removes the note placeholder that nothing renders any more", () => {
    for (const locale of ["az", "ru", "en"]) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
      expect(messages.common.addDealNote).toBeUndefined()
      expect(messages.common.sendEmailAction).toBeTruthy()
      expect(messages.common.actLogEntry).toBeTruthy()
    }
  })
})
