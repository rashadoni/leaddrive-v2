import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { DEFAULT_ORGANIZATION_TIMEZONE } from "@/lib/tenant-provisioning"

/**
 * 2026-11-09: пояс не был задан ни у одной организации, и сервер считал время
 * по UTC — голосовые отчёты брали «сегодня» с 4 утра по Баку. Владелец: «Да,
 * пояс Баку». Существующим организациям пояс проставлен на проде; новая
 * получает его при создании — единственным местом, которое их создаёт.
 */
describe("a new organization's time zone", () => {
  it("is Baku until an admin picks another", () => {
    expect(DEFAULT_ORGANIZATION_TIMEZONE).toBe("Asia/Baku")
    const source = readFileSync("src/lib/tenant-provisioning.ts", "utf8")
    const create = source.slice(source.indexOf("tx.organization.create({"), source.indexOf("// 2. Create admin User"))
    expect(create).toContain("settings: { timezone: DEFAULT_ORGANIZATION_TIMEZONE }")
  })
})
