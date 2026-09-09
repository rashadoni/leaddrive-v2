import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { TENANT_PLANS } from "@/lib/tenant-plans"

/**
 * `sales` — базовый групповой модуль: в нём живут сделки, лиды и предложения.
 * Тариф без него оставляет тенанта без воронки, и заметить это снаружи
 * невозможно: страницы просто исчезают из меню, а записи остаются в базе.
 *
 * Именно так и случилось. 9 сентября 2026 у шаблона Starter в базе прода не
 * оказалось `sales`. Организация, заведённая из этого шаблона 1 сентября,
 * девять дней не видела своих 12 сделок и 8 лидов — четверо пользователей,
 * данные на месте, доступ закрыт. Правило до этого существовало только
 * комментарием в коде, поэтому пропажу никто не поймал.
 *
 * Тест сторожит код. Базу он проверить не может — там канонические
 * PlanTemplate, — поэтому при изменении тарифов состояние в базе сверяется
 * отдельно, руками или скриптом.
 */
const BASE_MODULES = ["crm", "sales", "settings"] as const

describe("every plan carries the base modules", () => {
  it.each(Object.keys(TENANT_PLANS))("%s keeps deals, leads and quotes reachable", (plan) => {
    const features = TENANT_PLANS[plan as keyof typeof TENANT_PLANS].features as readonly string[]
    for (const mod of BASE_MODULES) {
      expect(features, `тариф ${plan} без модуля ${mod}`).toContain(mod)
    }
  })

  it("keeps the seed script in step with the code defaults", () => {
    // Комментарий в tenant-plans.ts требует, чтобы этот файл и сид совпадали.
    // Если сид разойдётся, новая база родится с тем же дефектом, а тест выше
    // останется зелёным: он читает только код.
    const seed = readFileSync("scripts/seed-plan-templates.mjs", "utf8")
    for (const plan of Object.keys(TENANT_PLANS)) {
      const row = new RegExp(`key:\\s*"${plan}"[^}]*`).exec(seed)
      expect(row, `в сиде нет тарифа ${plan}`).not.toBeNull()
      for (const mod of BASE_MODULES) {
        expect(row![0], `в сиде тариф ${plan} без модуля ${mod}`).toContain(`"${mod}"`)
      }
    }
  })
})
