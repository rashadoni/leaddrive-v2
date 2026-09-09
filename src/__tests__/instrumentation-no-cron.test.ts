import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const instrumentation = readFileSync(join(process.cwd(), "src/instrumentation.ts"), "utf8")

describe("Next.js instrumentation process boundary", () => {
  it("does not own scheduled jobs", () => {
    expect(instrumentation).not.toMatch(/\bsetInterval\b/)
    expect(instrumentation).not.toMatch(/\bsetTimeout\b/)
    expect(instrumentation).not.toContain("process.env.CRON_SECRET")
    expect(instrumentation).not.toContain("/api/")
    expect(instrumentation).not.toContain("runFinanceDeadlineJob")
    expect(instrumentation).not.toContain("runMtmAutoCheckoutJob")
  })
})
