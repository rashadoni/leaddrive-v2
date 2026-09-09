import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(
  resolve(process.cwd(), "tests/load/scenarios/workforce-morning-start.js"),
  "utf8",
)

describe("Workforce H6 morning-start load contract", () => {
  it("keeps the 5,000-user staging scenario fenced and credential-safe", () => {
    expect(source).toContain('positiveInteger("WORKFORCE_LOAD_USERS", 5000, 5000)')
    expect(source).toContain("WORKFORCE_LOAD_TOKEN_FILE")
    expect(source).toContain("credential.agentId")
    expect(source).toContain("seenTokens.has(token)")
    expect(source).toContain("seenAgentIds.has(agentId)")
    expect(source).toContain("jwtAgentId(token) !== agentId")
    expect(source).toContain("return {\n    base: baseUrl()")
    expect(source).toContain("WORKFORCE_LOAD_EXPECT_TRUST")
    expect(source).toContain("/api/v1/mtm/mobile/sync/push")
    expect(source).toContain('entity: "workdays"')
    expect(source).toContain('action: "START"')
    expect(source).not.toContain("console.log")
  })

  it("requires exact synthetic success rather than accepting conflicts", () => {
    expect(source).toContain('status === "ok"')
    expect(source).toContain('threshold: "count==0"')
    expect(source).toContain('threshold: "p(95)<10000"')
  })
})
