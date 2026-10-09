import { describe, expect, it } from "vitest"

// ПРОБА карточки 001, в main не попадает. Два «сделанных» правила: тест
// первого выполняется, тест второго ждёт настоящую базу и без
// ERP_TEST_DATABASE_URL пропускается — отметка на нём должна покраснеть.
const db = process.env.ERP_TEST_DATABASE_URL

describe("erp проба", () => {
  it("u1-A-01: тест выполняется и зелёный", () => {
    expect(1 + 1).toBe(2)
  })

  it.skipIf(!db)("u1-A-02: тест на настоящей базе", () => {
    expect(db).toBeTruthy()
  })
})
