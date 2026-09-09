// src/__tests__/lib-cron-auth.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { getRlsContext, rlsStorage } from "@/lib/rls-context"

function req(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/cron/test", { headers })
}

describe("requireCronAuth", () => {
  const OLD = process.env.CRON_SECRET
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret"
    rlsStorage.enterWith(undefined as never) // reset leaked context between tests
  })
  afterEach(() => { process.env.CRON_SECRET = OLD })

  it("503 when CRON_SECRET unset (closed-by-default)", async () => {
    delete process.env.CRON_SECRET
    const res = requireCronAuth(req({ "x-cron-secret": "anything" }))
    expect(res?.status).toBe(503)
  })

  it("401 on missing or wrong secret", () => {
    expect(requireCronAuth(req())?.status).toBe(401)
    expect(requireCronAuth(req({ "x-cron-secret": "wrong" }))?.status).toBe(401)
  })

  it("accepts x-cron-secret header and enters bypass context", () => {
    const res = requireCronAuth(req({ "x-cron-secret": "s3cret" }))
    expect(res).toBeNull()
    expect(getRlsContext()).toEqual({ bypass: true })
  })

  it("accepts Authorization: Bearer form", () => {
    expect(requireCronAuth(req({ authorization: "Bearer s3cret" }))).toBeNull()
  })
})
