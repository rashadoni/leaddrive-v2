import { afterEach, describe, expect, it, vi } from "vitest"

const SHA = "5f865d2e4dec0a1b2c3d4e5f60718293a4b5c6d7"
const BUILT = "2026-08-18T12:19:32.000Z"

async function callRoute(deploySha: string, builtAt: string) {
  vi.resetModules()
  vi.doMock("@/generated/build-sha", () => ({ DEPLOY_SHA: deploySha, BUILT_AT: builtAt }))
  const { GET } = await import("@/app/api/v1/public/build-info/route")
  const res = GET()
  return { res, body: await res.json() }
}

describe("GET /api/v1/public/build-info", () => {
  afterEach(() => {
    vi.doUnmock("@/generated/build-sha")
  })

  it("reports the exact deployed artifact revision and when it was built", async () => {
    const { res, body } = await callRoute(SHA, BUILT)
    expect(res.status).toBe(200)
    expect(body).toEqual({ sha: "5f865d2e4dec", artifactSha: SHA, builtAt: BUILT })
    expect(res.headers.get("Cache-Control")).toBe("no-store")
  })

  it("answers with nulls instead of failing on a build made outside the deploy", async () => {
    const { res, body } = await callRoute("", "")
    expect(res.status).toBe(200)
    expect(body).toEqual({ sha: null, artifactSha: null, builtAt: null })
  })

  it("refuses to report a malformed revision", async () => {
    const { body } = await callRoute("not-a-sha", BUILT)
    expect(body.sha).toBeNull()
    expect(body.artifactSha).toBeNull()
  })
})
