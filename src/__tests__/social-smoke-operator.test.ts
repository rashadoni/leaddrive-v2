import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const script = readFileSync(resolve(root, "scripts/ensure-social-smoke-user.mjs"), "utf8")
const browserSmoke = readFileSync(resolve(root, "scripts/social-monitoring-browser-smoke.mjs"), "utf8")
const workflow = readFileSync(resolve(root, ".github/workflows/ensure-social-smoke-user.yml"), "utf8")
const deployWorkflow = readFileSync(resolve(root, ".github/workflows/deploy.yml"), "utf8")

describe("dedicated Social Monitoring smoke operator", () => {
  it("is structurally unable to create an admin or modify a human login", () => {
    expect(script).toContain('role: "viewer"')
    expect(script).toContain("^social-smoke@")
    expect(script).not.toMatch(/role:\s*process\.env/)
    expect(workflow).toContain("^social-smoke@")
  })

  it("mints the credential on the server and never lets it leave, clearing MFA only on the dedicated account", () => {
    // Supersedes an older contract that took a pre-computed SMOKE_PASSWORD_HASH
    // through the environment. The script now generates the credential on the
    // production box, so the properties worth guarding moved with it: nothing
    // to intercept in CI, but now a file on disk that must not be readable by
    // anyone else and must not be echoed.
    expect(script).toContain("generateStrongTemporaryPassword")
    expect(script).toContain("crypto.randomBytes")     // CSPRNG, not Math.random
    expect(script).toContain("bcrypt.hash")            // never stored in the clear
    expect(script).toContain("0o600")                  // root-only credential file
    expect(script).toContain("0o700")                  // ...in a root-only directory
    // The password itself must never reach stdout: CI logs and shell history are
    // exactly the places this design exists to keep it out of.
    expect(script).not.toMatch(/console\.log\([^)]*\bpassword\b/)
    // MFA reset stays scoped to the dedicated smoke account.
    expect(script).toContain("require2fa: false")
    expect(script).toContain("totpEnabled: false")
    expect(script).toContain("smsAuthEnabled: false")
  })

  it("uses the Auth.js redirect-return protocol and rejects a failed credentials callback", () => {
    expect(browserSmoke).toContain('"X-Auth-Return-Redirect": "1"')
    expect(browserSmoke).toContain("callbackUrl:")
    expect(browserSmoke).toContain('searchParams.get("error")')
    expect(browserSmoke).toContain('cookie.name.endsWith("authjs.session-token")')
    expect(browserSmoke).not.toContain('redirect: "false"')
    expect(browserSmoke).not.toContain('json: "true"')
  })

  it("keeps the production smoke read-only while checking the global-search wizard", () => {
    expect(browserSmoke).toContain('getByTestId("social-profile-global-search-hint")')
    expect(browserSmoke).toContain('getByTestId("social-profile-select-all").count()')
    expect(browserSmoke).toContain('locator("#saved-source-search").count()')
    expect(browserSmoke).toContain("directPickerRequestCount")
    expect(browserSmoke).toContain("social_profile_source_picker_api_requested")
    expect(browserSmoke).toContain("if (paidCommentsSource?.id)")
    expect(browserSmoke).not.toContain('throw new Error("paid_comments_source_not_configured")')
    expect(browserSmoke).not.toContain("owned_or_disabled_sources_visible")
    expect(browserSmoke).not.toContain("deleted_own_sources_visible")
    expect(browserSmoke).not.toContain('getByTestId("social-paid-run-confirm").click')
    expect(browserSmoke).not.toContain('getByText("Monitorinqi başlat").click')
    expect(deployWorkflow).toContain("Upload Social Monitoring browser evidence")
    expect(deployWorkflow).toContain("social-monitoring-wizard-smoke.png")
  })
})
