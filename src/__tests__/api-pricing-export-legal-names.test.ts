import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Справочник юрлиц клиентов для выгрузки цен до 2026-09-11 лежал в
 * `public/data/company_legal_names.json` — в публичном репозитории. Теперь он
 * живёт в runtime-каталоге прода и в артефакт не попадает. Тест держит обе
 * половины: файл читается оттуда, а без файла выгрузка работает, как раньше
 * работала без него (генератор подставит «КОД MMC»), и не шумит в логах.
 */
const runtimeRoot = mkdtempSync(join(tmpdir(), "pricing-legal-"))
afterAll(() => rmSync(runtimeRoot, { recursive: true, force: true }))

vi.mock("@/lib/runtime-paths", () => ({
  resolveRuntimePaths: () => ({ runtimeRoot }),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: { pricingProfile: { findMany: vi.fn().mockResolvedValue([]) } },
}))
vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn().mockResolvedValue("org-1"),
  getSession: vi.fn().mockResolvedValue(null),
}))
vi.mock("@/lib/pricing-export", () => ({
  generateTemplate1: vi.fn().mockResolvedValue(Buffer.from("x")),
  generateTemplate2: vi.fn().mockResolvedValue(Buffer.from("x")),
  generateBudgetPL: vi.fn().mockResolvedValue(Buffer.from("x")),
}))

import { POST } from "@/app/api/v1/pricing/export/route"
import { generateTemplate1 } from "@/lib/pricing-export"

const legalFile = join(runtimeRoot, "state", "pricing", "company_legal_names.json")

function exportRequest() {
  return new Request("http://localhost/api/v1/pricing/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ template: "1" }),
  }) as any
}

beforeEach(() => {
  vi.mocked(generateTemplate1).mockClear()
  rmSync(join(runtimeRoot, "state"), { recursive: true, force: true })
})

describe("pricing export legal names", () => {
  it("reads them from the runtime state directory, not from the repository", async () => {
    mkdirSync(join(runtimeRoot, "state", "pricing"), { recursive: true })
    writeFileSync(legalFile, JSON.stringify({ ACME: "ACME TRADING MMC" }))

    const res = await POST(exportRequest())

    expect(res.status).toBe(200)
    expect(vi.mocked(generateTemplate1).mock.calls[0][1]).toEqual({ ACME: "ACME TRADING MMC" })
  })

  it("exports without the file, quietly — that is every tenant but one", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})

    const res = await POST(exportRequest())

    expect(res.status).toBe(200)
    expect(vi.mocked(generateTemplate1).mock.calls[0][1]).toEqual({})
    // ENOENT — штатный случай, логи им не засоряем.
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })

  it("still reports a broken file instead of swallowing it", async () => {
    mkdirSync(join(runtimeRoot, "state", "pricing"), { recursive: true })
    writeFileSync(legalFile, "{ not json")
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})

    const res = await POST(exportRequest())

    expect(res.status).toBe(200)
    expect(errors).toHaveBeenCalled()
    errors.mockRestore()
  })
})
