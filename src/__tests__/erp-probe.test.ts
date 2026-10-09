import { describe, expect, it } from "vitest"

// ПРОБА карточки 001: тест сделанного правила завёрнут в describe.skip.
// В main этот файл не попадает.
describe.skip("u1-A-01: проба — блок выключен", () => {
  it("меню настроек", () => {
    expect(1 + 1).toBe(2)
  })
})
