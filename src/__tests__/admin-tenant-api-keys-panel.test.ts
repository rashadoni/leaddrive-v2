import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"

import { usesLegacyInboxScope, isLegacyInboxScope } from "@/lib/admin/api-key-scopes"

/**
 * Суперадминская карточка API-ключей тенанта: владелец должен видеть, у каких
 * клиентов есть внешние интеграции и с какими scope'ами, НЕ заходя в CRM каждого
 * тенанта под его админом.
 */
const pageSource = readFileSync(
  path.resolve(__dirname, "../app/admin/tenants/[id]/page.tsx"),
  "utf8",
)

/** Тот же исходник без комментариев — чтобы страж ловил КОД, а не пояснение к нему. */
const pageCode = pageSource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")

describe("admin tenant API-keys panel", () => {
  it("никогда не тянет секрет ключа в суперадминку", () => {
    // В БД лежит только хэш, но и его незачем поднимать в RSC-пейлоад: в UI
    // живёт keyPrefix. Явный select + этот страж = секрет не утечёт правкой
    // «добавлю ещё пару полей».
    expect(pageCode).not.toContain("keyHash")
    expect(pageCode).toMatch(/apiKeys:\s*\{\s*\n\s*select:/)
  })

  it("сохраняет суперадмин-гейт и RLS-обход вокруг кросс-тенантного чтения", () => {
    expect(pageSource).toContain("isSuperAdminSession()")
    expect(pageSource).toContain("runWithRlsBypass")
  })

  it("помечает ключи со старыми inbox-scope'ами (им нужен read:social)", () => {
    // После отделения соцмониторинга /api/v1/social требует read:social /
    // write:social; scope'ы выпущенного ключа не редактируются, поэтому такие
    // интеграции нужно перевыпустить — метка показывает их владельцу сразу.
    expect(usesLegacyInboxScope(["read:inbox"])).toBe(true)
    expect(usesLegacyInboxScope(["write:contacts", "write:inbox"])).toBe(true)
    expect(usesLegacyInboxScope(["read:social", "write:social"])).toBe(false)
    expect(usesLegacyInboxScope(["read:contacts"])).toBe(false)
    expect(usesLegacyInboxScope([])).toBe(false)
    expect(isLegacyInboxScope("read:inbox")).toBe(true)
    expect(isLegacyInboxScope("read:social")).toBe(false)
  })
})
