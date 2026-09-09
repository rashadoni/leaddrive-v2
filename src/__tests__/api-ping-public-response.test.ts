import { beforeEach, describe, expect, it, vi } from "vitest"

const { count } = vi.hoisted(() => ({ count: vi.fn() }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { count },
  },
}))

import { GET } from "@/app/api/v1/ping/route"

describe("GET /api/v1/ping", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    count.mockResolvedValue(42)
  })

  it("checks the database without exposing counts or timing", async () => {
    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(count).toHaveBeenCalledOnce()
  })

  it("does not expose database error details", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
    count.mockRejectedValue(new Error("postgres://secret-user:secret-pass@internal-db"))

    const response = await GET()
    const body = await response.text()

    expect(response.status).toBe(500)
    expect(JSON.parse(body)).toEqual({ ok: false })
    expect(body).not.toContain("postgres")
    expect(body).not.toContain("secret")
    errorSpy.mockRestore()
  })
})
