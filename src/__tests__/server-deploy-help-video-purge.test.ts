import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const deployScript = readFileSync(join(process.cwd(), "scripts/server-deploy.sh"), "utf8")

describe("production help-video cache purge", () => {
  it("does not report a healthy application rollout as failed when Cloudflare rejects the purge", () => {
    const purgeBlock = deployScript.slice(
      deployScript.indexOf("# ── Step 9: Purge replaced help-video assets at Cloudflare"),
      deployScript.indexOf("# ── Step 10: Cleanup"),
    )

    expect(purgeBlock).toContain("Cloudflare help-video purge completed")
    expect(purgeBlock).toContain("WARNING: Cloudflare help-video purge failed after the app became healthy")
    expect(purgeBlock).not.toContain('fatal "Cloudflare help-video purge failed')
  })
})
