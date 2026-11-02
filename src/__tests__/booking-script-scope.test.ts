import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const state = vi.hoisted(() => ({ construct: vi.fn(), execute: vi.fn() }))
vi.mock("@prisma/client", () => ({ PrismaClient: class {
  constructor(options: unknown) { state.construct(options) }
  $executeRaw(...args: unknown[]) { return state.execute(...args) }
} }))
import { makeScriptPrisma } from "../../scripts/_rls.mjs"

beforeEach(() => { vi.clearAllMocks(); state.execute.mockResolvedValue(0) })
afterEach(() => vi.unstubAllEnvs())
describe("operator script database scope", () => {
  it("uses the explicit operator connection and tenant without bypassing RLS or mutating the web connection", async () => {
    const web = "postgresql://web:synthetic@db.example.test/app"
    vi.stubEnv("DATABASE_URL", web)
    await makeScriptPrisma({ orgId: "org-a", databaseUrl: "postgresql://operator:synthetic@db.example.test/app?sslmode=require" })
    const actual = new URL(state.construct.mock.calls[0][0].datasourceUrl)
    expect(actual.username).toBe("operator")
    expect(actual.searchParams.get("connection_limit")).toBe("1")
    expect(actual.searchParams.get("sslmode")).toBe("require")
    expect(process.env.DATABASE_URL).toBe(web)
    const [sql, orgId] = state.execute.mock.calls[0]
    expect(sql.join("?")).toContain("'app.org_id'")
    expect(sql.join("?")).not.toContain("app.rls_bypass")
    expect(orgId).toBe("org-a")
  })
  it("refuses an operator connection with no explicit organization", async () => {
    await expect(makeScriptPrisma({ databaseUrl: "postgresql://operator:synthetic@db.example.test/app" })).rejects.toThrow("organization scope")
    expect(state.construct).not.toHaveBeenCalled()
    expect(state.execute).not.toHaveBeenCalled()
  })
})
