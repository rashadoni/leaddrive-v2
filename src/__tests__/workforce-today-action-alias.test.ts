import { describe, expect, it } from "vitest"
import { POST as compatibilityPost } from "@/app/api/v1/mtm/week/workday/route"
import { POST as workforcePost } from "@/app/api/v1/workforce/today/action/route"

describe("Workforce Today action transport", () => {
  it("uses the exact canonical authenticated workday handler", () => {
    expect(workforcePost).toBe(compatibilityPost)
  })
})
