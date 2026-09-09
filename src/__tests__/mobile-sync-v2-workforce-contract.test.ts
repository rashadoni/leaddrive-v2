import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const contract = readFileSync(join(
  process.cwd(), "docs/mobile-sync-v2-workforce-contract.md"), "utf8")

describe("MTM mobile sync v2 active-workday workforce contract", () => {
  it("pins the own-agent active-only, GPS/note-free read contract", () => {
    expect(contract).toMatch(/only an active workday owned\s+by the authenticated Field agent/)
    expect(contract).toContain("`STARTED` or `PAUSED`")
    expect(contract).toContain("excludes start/end GPS, event coordinates, accuracy, event notes")
    expect(contract).toMatch(/completed history, HRM requests, request reasons,\s+decision\s+notes/)
    expect(contract).toMatch(/Protocol v1 stays\s+the sole authority/)
  })

  it("pins independent cohort admission and stream-local rollback", () => {
    expect(contract).toContain("exact enabled, unexpired `mtm_mobile_sync_cohorts` row")
    expect(contract).toContain("`workforce` never inherits a `routes`, `visits` or `tasks` cohort")
    expect(contract).toMatch(/rebuilds\s+only this cache\/cursor/)
    expect(contract).toMatch(/never clears a Field outbox, media queue or another\s+stream's cursor/)
    expect(contract).toContain("Rollback disables only the exact `workforce` cohort")
  })
})
