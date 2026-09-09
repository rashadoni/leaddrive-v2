import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(path, "utf8")

const knownPublishedCredentials = /admin123|demo1234|farid123|Demo1234!|changeme/iu
const productionHost = /https:\/\/(?:v2|app)\.leaddrivecrm\.org/iu

describe("operational script credential and remote-target safety", () => {
  it("requires explicit screenshot credentials and exact-host remote confirmation", () => {
    const authenticatedCaptures = [
      "scripts/capture-ai-email.mjs",
      "scripts/capture-email-portal.mjs",
      "scripts/capture-fixes.mjs",
      "scripts/capture-marketing-screenshots.mjs",
      "scripts/take-screenshots.mjs",
    ].map(read)
    for (const source of authenticatedCaptures) {
      expect(source).toContain("requireScreenshotAuth")
      expect(source).not.toMatch(knownPublishedCredentials)
      expect(source).not.toMatch(productionHost)
      expect(source).not.toContain("ignoreHTTPSErrors: true")
    }

    const config = read("scripts/screenshot-auth-config.mjs")
    expect(config).toContain("SCREENSHOT_EMAIL and SCREENSHOT_PASSWORD are required")
    expect(config).toContain("env.CONFIRM_REMOTE_SCREENSHOT !== target.hostname")
    expect(config).toContain("Remote screenshot targets must use HTTPS")

    for (const path of ["scripts/capture-screenshots.mjs", "scripts/capture-advisor-screenshots.mjs"]) {
      const source = read(path)
      expect(source).toContain("requireScreenshotTarget")
      expect(source).not.toMatch(productionHost)
      expect(source).not.toContain("ignoreHTTPSErrors: true")
    }
  })

  it("requires explicit help-video credentials and exact-host remote confirmation", () => {
    const config = read("scripts/help-video/auth-config.mjs")
    expect(config).toContain("HELP_VIDEO_EMAIL, HELP_VIDEO_PASSWORD, and HELP_VIDEO_ORG_SLUG are required")
    expect(config).toContain("env.CONFIRM_REMOTE_HELP_VIDEO !== target.hostname")
    expect(config).toContain("Remote help-video targets must use HTTPS")

    for (const path of ["scripts/help-video/generate-browser-guided.mjs", "scripts/produce-guides.mjs"]) {
      const source = read(path)
      expect(source).toContain("requireHelpVideoAuth")
      expect(source).not.toMatch(knownPublishedCredentials)
      expect(source).not.toContain('process.env.HELP_VIDEO_PASSWORD ||')
    }
  })

  it("keeps local MTM fixtures on local APIs and databases with policy-compliant env passwords", () => {
    const seed = read("scripts/seed-mtm.ts")
    expect(seed).toContain("passwordPolicyError")
    expect(seed).toContain("process.env.MTM_DEMO_ADMIN_PASSWORD")
    expect(seed).toContain("process.env.MTM_DEMO_AGENT_PASSWORD")
    expect(seed).toContain("only runs in non-production against a localhost database")
    expect(seed.indexOf("const dbUrl")).toBeLessThan(seed.indexOf("prisma = await makeScriptPrisma()"))
    expect(seed).not.toMatch(knownPublishedCredentials)
    expect(seed).not.toMatch(/console\.log\([^\n]*(?:ADMIN_PASSWORD|AGENT_PASSWORD)/u)

    for (const path of ["scripts/farid-day.ts", "scripts/farid-edge-cases.ts"]) {
      const source = read(path)
      expect(source).toContain("passwordPolicyError")
      expect(source).toContain("process.env.MTM_DEMO_AGENT_PASSWORD")
      expect(source).toContain("assertLocalSafety()")
      expect(source).not.toMatch(knownPublishedCredentials)
    }
    expect(read("scripts/farid-edge-cases.ts")).toContain("localhost API and database")
    const socialQueueE2e = read("scripts/social-monitoring-server-queue-e2e.mjs")
    expect(socialQueueE2e).toContain("localhost API and database")
    expect(socialQueueE2e).toContain("passwordPolicyError(password)")
  })

  it("requires explicit XSS targets and credentials, verifies TLS, and redacts auth material", () => {
    const paths = [
      "scripts/xss-exploit.mjs",
      "scripts/xss-exploit-test.js",
      "scripts/xss-test-02-07-08.mjs",
    ]
    const combined = paths.map(read).join("\n")
    for (const path of paths) {
      const source = read(path)
      expect(source).toContain("process.env.BASE_URL")
      expect(source).toContain("process.env.ADMIN_EMAIL")
      expect(source).toContain("process.env.ADMIN_PASSWORD")
      expect(source).toContain("process.env.CONFIRM_REMOTE_XSS_TEST !== target.hostname")
      expect(source).toContain("Remote XSS test targets must use HTTPS")
      expect(source).toContain("Local XSS test targets are blocked when NODE_ENV=production")
      expect(source).toContain("redactSensitive")
      expect(source).not.toMatch(productionHost)
      expect(source).not.toMatch(knownPublishedCredentials)
      expect(source).not.toContain("rejectUnauthorized: false")
    }
    expect(combined).not.toContain("CSRF Token:")
    expect(combined).not.toContain("TOTP Secret obtained:")
    expect(combined).not.toContain("Session cookie string:")
    expect(combined).not.toContain("All cookies after auth:")
  })

  it("bounds remote rate-limit probes and gates WhatsApp test traffic by exact hostname", () => {
    const rateLimit = read("scripts/test_rate_limit.py")
    expect(rateLimit).toContain('os.environ.get("TARGET_BASE_URL"')
    expect(rateLimit).toContain('os.environ.get("TEST_EMAIL"')
    expect(rateLimit).toContain('os.environ.get("CONFIRM_REMOTE_RATE_LIMIT_TEST") != parsed_target.hostname')
    expect(rateLimit).toContain("ATTEMPTS > 10")
    expect(rateLimit).toContain("Local rate-limit targets are blocked when NODE_ENV=production")
    expect(rateLimit).not.toMatch(productionHost)
    expect(rateLimit).not.toContain("resp.text")
    expect(rateLimit).not.toContain("token[:")

    const whatsapp = read("scripts/test-whatsapp-call-webhook.mjs")
    expect(whatsapp).toContain("requireTargetBaseUrl")
    expect(whatsapp).toContain("process.env.CONFIRM_REMOTE_WA_TEST !== target.hostname")
    expect(whatsapp).toContain("Remote WhatsApp test targets must use HTTPS")
    expect(whatsapp).toContain("Local WhatsApp test targets are blocked when NODE_ENV=production")
    expect(whatsapp).not.toContain("DEFAULT_BASE_URL")
    expect(whatsapp).not.toMatch(productionHost)
  })
})
