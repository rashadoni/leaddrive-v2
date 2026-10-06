import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
const mock = vi.hoisted(() => ({ auth: vi.fn(), mobile: vi.fn(), apiKey: vi.fn() }))
vi.mock("@/lib/auth", () => ({ auth: mock.auth }))
vi.mock("@/lib/prisma", () => ({ prisma: { apiKey: { findFirst: mock.apiKey } } }))
vi.mock("@/lib/mobile-auth", () => ({ getMobileAuth: mock.mobile, resolveMobileAuth: vi.fn() }))
import { getOrgId, requireAuth } from "@/lib/api-auth"
const CANARY = "PRIVATE_SYNTHETIC_person@example.invalid"
const request = () => new NextRequest(`https://example.invalid/api/v1/contacts/${CANARY}`, { headers: { authorization: "Bearer synthetic-mobile-token" } })
beforeEach(() => { vi.clearAllMocks(); mock.auth.mockResolvedValue(null); mock.mobile.mockReturnValue({ agentId: CANARY, orgId: CANARY, email: CANARY }); mock.apiKey.mockResolvedValue(null) })
afterEach(() => vi.restoreAllMocks())
describe("shared mobile authentication rejection diagnostics", () => {
  it.each(["scope", "permission"])("keeps %s denial without agent identifier or path", async kind => {
    const sink = vi.spyOn(console, "warn").mockImplementation(() => {})
    if (kind === "scope") expect(await getOrgId(request())).toBeNull()
    else expect((await requireAuth(request()) as Response).status).toBe(401)
    expect(sink.mock.calls).toEqual([["[application] operation failed", { operation: kind === "scope" ? "auth-mobile-scope-rejected" : "auth-mobile-permission-rejected" }]])
  })
})
