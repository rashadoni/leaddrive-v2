import { describe, expect, it } from "vitest"
import { GET } from "@/app/api/health/route"

describe("GET /api/health", () => {
  it("returns only shallow liveness without process timing metadata", async () => {
    const response = await GET()
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(JSON.parse(body)).toEqual({ ok: true })
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(body).not.toContain("timestamp")
    expect(body).not.toContain("uptime")
  })
})
