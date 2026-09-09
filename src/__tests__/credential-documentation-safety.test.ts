import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(path, "utf8")

describe("credential-bearing operator documentation", () => {
  it("keeps load tests staging-only and reads credentials from the environment", () => {
    const guide = read("tests/load/README-loadtest.md")
    const config = read("tests/load/config.js")

    expect(guide).toContain("LOAD_TEST_AGENT_PASSWORD")
    expect(guide).toContain("MARS_LOADTEST_AGENT_PASSWORD")
    expect(guide).toContain('echo "::add-mask::$TOKEN"')
    expect(guide).not.toContain("testpassword123")
    expect(guide).not.toContain("https://mars.leaddrivecrm.org")
    expect(guide).not.toContain("cat /tmp/mars-test-token.txt")

    expect(config).toContain("LOAD_TEST_ENVIRONMENT !== 'staging'")
    expect(config).toContain("CONFIRM_REMOTE_LOAD_TEST !== url.hostname")
    expect(config).toContain("Remote load-test targets must use HTTPS")
  })

  it("requires the real encryption and Meta credentials for token inspection", () => {
    const source = read("scripts/check-fb-token.mjs")

    expect(source).toContain("requireEnv('NEXTAUTH_SECRET')")
    expect(source).toContain("requireEnv('FACEBOOK_APP_ID')")
    expect(source).toContain("requireEnv('FACEBOOK_APP_SECRET')")
    expect(source).not.toContain("ld-fallback-secret-change-me")
    expect(source).not.toContain("JSON.stringify(debugJson.data")
    expect(source).not.toMatch(/console\.log\([^\n]*(?:token|secret|password|cookie)/iu)
  })

  it("does not publish reusable historical credentials or capability tokens", () => {
    const evidence = [
      "deliverables/ssrf_analysis_deliverable.md",
      "deliverables/ssrf_exploitation_evidence.md",
      "deliverables/authz_exploitation_evidence.md",
      "deliverables/xss_analysis_deliverable.md",
    ].map(read).join("\n")

    expect(evidence).not.toContain("admin123")
    expect(evidence).toContain("[REDACTED_LEGACY_PASSWORD]")
    expect(evidence).toContain("[REDACTED_CSRF_TOKEN]")
    expect(evidence).toContain("[REDACTED_CALENDAR_TOKEN]")
  })

  it("keeps the tracked legacy snapshot free of credential material", () => {
    const users = JSON.parse(read("scripts/v1-data/users.json")) as Array<Record<string, unknown>>
    const portalUsers = JSON.parse(read("scripts/v1-data/portal_users.json")) as Array<Record<string, unknown>>
    const smtpSettings = JSON.parse(read("scripts/v1-data/smtp_settings.json")) as Array<Record<string, unknown>>
    const channels = JSON.parse(read("scripts/v1-data/channel_configs.json")) as Array<Record<string, unknown>>
    const importer = read("scripts/import-v1.ts")

    for (const user of users) {
      expect(user.password_hash).toBeNull()
      expect(user.totp_secret).toBeNull()
      expect(user.calendar_token).toBeNull()
    }
    for (const user of portalUsers) expect(user.password_hash).toBeNull()
    for (const settings of smtpSettings) expect(settings.smtp_password).toBeNull()
    for (const channel of channels) {
      expect(channel.bot_token).toBeNull()
      expect(channel.api_key).toBeNull()
      expect(channel.webhook_url).toBeNull()
      expect(channel.is_active).toBe(0)
    }

    expect(importer).toContain("botToken: null")
    expect(importer).toContain("webhookUrl: null")
    expect(importer).toContain("apiKey: null")
    expect(importer).toContain("isActive: false")
    expect(importer).not.toContain("botToken: toStr((ch as any).bot_token)")
  })
})
