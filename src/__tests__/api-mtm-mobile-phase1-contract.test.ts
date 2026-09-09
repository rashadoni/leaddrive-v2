import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8").trim()
}

describe("Phase 1 mobile URL compatibility", () => {
  it("keeps the APK singular request URLs on the canonical handlers", () => {
    expect(source("src/app/api/v1/mtm/routes/[id]/change-request/route.ts"))
      .toBe('export { POST } from "../change-requests/route"')
    expect(source("src/app/api/v1/mtm/customer-create-request/route.ts"))
      .toBe('export { GET, POST } from "../customer-create-requests/route"')
    expect(source("src/app/api/v1/mtm/customer-create-request/[id]/route.ts"))
      .toBe('export { PATCH } from "../../customer-create-requests/[id]/route"')
  })
})
