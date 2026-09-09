import { describe, it, expect } from "vitest"
import {
  resolveTenantLandingPath,
  readTenantLandingPath,
  isSafeLandingPath,
  landingPathAllowed,
} from "@/lib/tenant-landing"

/**
 * Стартовая страница тенанта: корень «/» раньше жёстко вёл на /dashboard, и
 * тенант без модуля `crm` (чистый соцмониторинг) упирался во вход в страницу,
 * которую гейт лэйаута ему закрывает.
 */
const socialOnly = { plan: "enterprise", role: "admin", modules: { social: true, settings: true } }
const fullCrm = { plan: "enterprise", role: "admin", modules: { crm: true, social: true, settings: true } }

describe("resolveTenantLandingPath", () => {
  it("уважает выбор суперадмина", () => {
    const path = "/social-monitoring?scope=all&view=overview"
    expect(resolveTenantLandingPath({ ...socialOnly, landingPath: path })).toBe(path)
  })

  it("без настройки ведёт на первый ДОСТУПНЫЙ пункт меню, а не на /dashboard", () => {
    // Ради этого всё и делалось: соц-тенант должен попадать в свой раздел.
    const resolved = resolveTenantLandingPath(socialOnly)
    expect(resolved.startsWith("/social-monitoring")).toBe(true)
    // Обычный тенант с CRM по-прежнему попадает на дашборд.
    expect(resolveTenantLandingPath(fullCrm)).toBe("/dashboard")
  })

  it("игнорирует настройку на выключённый модуль", () => {
    // Модуль могли выключить уже после того, как страницу выбрали.
    const resolved = resolveTenantLandingPath({ ...socialOnly, landingPath: "/inbox" })
    expect(resolved.startsWith("/social-monitoring")).toBe(true)
  })

  it("не даёт увести тенанта на чужой хост", () => {
    for (const evil of ["//evil.com", "https://evil.com", "/\\evil.com", "evil", "/path\\x", 42, null]) {
      expect(isSafeLandingPath(evil), String(evil)).toBe(false)
      expect(resolveTenantLandingPath({ ...socialOnly, landingPath: evil }).startsWith("/social-monitoring")).toBe(true)
    }
  })

  it("последний рубеж — /dashboard, когда доступного меню нет вовсе", () => {
    expect(resolveTenantLandingPath({ plan: "starter", role: "viewer", modules: {} })).toBe("/dashboard")
  })

  it("путь вне меню (например /settings/profile) не блокируется — его гейтит сам роут", () => {
    expect(landingPathAllowed("/settings/profile", socialOnly)).toBe(true)
  })
})

describe("readTenantLandingPath", () => {
  it("читает настройку организации и отбрасывает мусор", () => {
    expect(readTenantLandingPath({ landingPath: "/social-monitoring?view=overview" }))
      .toBe("/social-monitoring?view=overview")
    expect(readTenantLandingPath({ landingPath: "//evil.com" })).toBeUndefined()
    expect(readTenantLandingPath({})).toBeUndefined()
    expect(readTenantLandingPath(null)).toBeUndefined()
    expect(readTenantLandingPath("строка вместо объекта")).toBeUndefined()
  })
})
