import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
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

  // Раньше здесь проверялось, что в снимке v1 нет паролей и токенов. Снимок
  // удалён из репозитория целиком, и проверять в нём больше нечего — но
  // утверждение стало сильнее, а не слабее: не «в данных нет учёток», а
  // «данных нет».
  //
  // Почему это важнее прежней формулировки. Тот тест сторожил учётные данные и
  // молчал про личные: в снимке лежали 577 живых контактов с именами, рабочей
  // почтой и телефонами, и он проходил зелёным. Пароли были вычищены, люди —
  // нет.
  it("keeps no legacy personal-data snapshot in the repository", () => {
    const gone = [
      "scripts/v1-data",
      "migration_data",
      "cost_model_migration_data",
      "public/data/company_details.json",
      "public/data/pricing_data.json",
    ]
    for (const rel of gone) {
      expect(existsSync(join(process.cwd(), rel)), `${rel} снова в репозитории`).toBe(false)
    }
  })

  it("keeps the v1 importer stripping credentials, snapshot or not", () => {
    // Импортёр остаётся: им ещё могут воспользоваться, подложив выгрузку извне.
    // Его обязанность обнулять учётные данные от удаления снимка не исчезла.
    const importer = read("scripts/import-v1.ts")
    expect(importer).toContain("botToken: null")
    expect(importer).toContain("webhookUrl: null")
    expect(importer).toContain("apiKey: null")
    expect(importer).toContain("isActive: false")
  })
})
