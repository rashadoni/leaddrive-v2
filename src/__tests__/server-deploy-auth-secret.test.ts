import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const deployScript = readFileSync(join(process.cwd(), "scripts/server-deploy.sh"), "utf8")
const envExample = readFileSync(join(process.cwd(), ".env.example"), "utf8")

describe("production deploy auth-secret preflight", () => {
  it("validates the secret before a preflight can report success", () => {
    const envLoadAt = deployScript.indexOf('load_dotenv_file "$APP_ENV_SOURCE_FILE"')
    const validationAt = deployScript.indexOf("\nvalidate_nextauth_secret\n", envLoadAt)
    const successfulExitAt = deployScript.indexOf('log "Deploy preflight passed')

    expect(envLoadAt).toBeGreaterThan(0)
    expect(validationAt).toBeGreaterThan(envLoadAt)
    expect(validationAt).toBeLessThan(successfulExitAt)
  })

  it("rejects the documented placeholder and weak values without logging the secret", () => {
    const validator = deployScript.slice(
      deployScript.indexOf("validate_nextauth_secret()"),
      deployScript.indexOf("validate_database_roles()"),
    )

    expect(validator).toContain("change-me-in-production")
    expect(validator).toContain("must be at least 32 bytes")
    expect(validator).toContain("insufficient character diversity")
    expect(validator).not.toMatch(/log[^\n]*\$NEXTAUTH_SECRET/)
    expect(validator).not.toMatch(/echo[^\n]*\$NEXTAUTH_SECRET/)
  })

  it("documents generation without committing a sample signing key", () => {
    expect(envExample).toContain("openssl rand -base64 32")
    expect(envExample).toMatch(/^NEXTAUTH_SECRET=""$/m)
    expect(envExample).not.toMatch(/^NEXTAUTH_SECRET="change-me-in-production"$/m)
  })
})
