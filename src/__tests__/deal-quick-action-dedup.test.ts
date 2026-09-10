import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const quickActionSource = readFileSync(
  "src/components/deals/quick-action-bar.tsx",
  "utf8",
)
const dealPageSource = readFileSync(
  "src/app/(dashboard)/deals/[id]/page.tsx",
  "utf8",
)

describe("deal quick actions", () => {
  it("keeps next-step creation in the dedicated widget only", () => {
    expect(quickActionSource).not.toContain("/next-steps")
    expect(quickActionSource).not.toContain('key: "task"')
    expect(dealPageSource).not.toContain("onTaskAdded=")
  })

  it("has nothing left to duplicate: the bar only sends email", () => {
    /*
     * Прежняя редакция этого теста сторожила «заметочную» копирайтинг-пару
     * `labels.notePlaceholder` / `addDealNote`. Вкладки «Заметка» больше нет:
     * она слала тот же `POST /api/v1/activities`, что и форма в ленте, только
     * без описания. Осталось одно действие, и проверять надо его.
     */
    expect(quickActionSource).not.toContain("labels.notePlaceholder")
    expect(quickActionSource).not.toContain("labels.note")
    expect(dealPageSource).not.toContain("addDealNote")
    expect(quickActionSource).toContain("labels.email")
    expect(quickActionSource).toContain("/send-email")
  })
})
