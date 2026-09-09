import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const deployScript = readFileSync(join(process.cwd(), "scripts/server-deploy.sh"), "utf8")

describe("production deploy public abuse guard preflight", () => {
  it("requires the shared Redis configuration before reporting preflight success", () => {
    const envLoadAt = deployScript.indexOf('load_dotenv_file "$APP_ENV_SOURCE_FILE"')
    const redisRequirementAt = deployScript.indexOf("\nrequire_env REDIS_URL\n", envLoadAt)
    const successfulExitAt = deployScript.indexOf('log "Deploy preflight passed')

    expect(envLoadAt).toBeGreaterThan(0)
    expect(redisRequirementAt).toBeGreaterThan(envLoadAt)
    expect(redisRequirementAt).toBeLessThan(successfulExitAt)
  })

  it("verifies Redis connectivity and authentication before reporting preflight success", () => {
    const envLoadAt = deployScript.indexOf('load_dotenv_file "$APP_ENV_SOURCE_FILE"')
    const redisProbeAt = deployScript.indexOf("\nvalidate_redis_connection\n", envLoadAt)
    const successfulExitAt = deployScript.indexOf('log "Deploy preflight passed')

    expect(deployScript).toContain("cannot connect and authenticate to REDIS_URL")
    expect(redisProbeAt).toBeGreaterThan(envLoadAt)
    expect(redisProbeAt).toBeLessThan(successfulExitAt)
  })
})
