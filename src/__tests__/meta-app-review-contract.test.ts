import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

const LOCALES = ["en", "ru", "az"] as const

describe("Meta App Review public contract", () => {
  it("uses the reviewed App ID in the submission and deletion instructions", () => {
    const submission = readFileSync("docs/meta-app-review-submission.md", "utf8")
    expect(submission).toContain("2414060595720618")
    expect(submission).not.toContain("1276226757359622")

    for (const locale of LOCALES) {
      const messages = JSON.parse(readFileSync("messages/" + locale + ".json", "utf8"))
      expect(messages.dataDeletion.intro).toContain("2414060595720618")
    }
  })

  it("keeps Instagram Login and Facebook Login on separate catalog actions", () => {
    const catalog = readFileSync("src/app/(dashboard)/settings/channels/page.tsx", "utf8")
    expect(catalog).toContain(
      'oauthStart: "/api/v1/social/oauth/facebook/start?from=channels-facebook"',
    )
    expect(catalog).toContain(
      'oauthStart: "/api/v1/social/oauth/instagram/start?from=channels-instagram"',
    )
    expect(catalog).not.toContain(
      'oauthStart: "/api/v1/social/oauth/facebook/start?from=channels-instagram"',
    )
  })

  it("requests the Instagram Login permissions declared to Meta", () => {
    const start = readFileSync(
      "src/app/api/v1/social/oauth/instagram/start/route.ts",
      "utf8",
    )
    expect(start).toContain('"instagram_business_basic"')
    expect(start).toContain('"instagram_business_manage_messages"')
  })

  it("stages replacement Meta apps without editing an existing live connection", () => {
    const connect = readFileSync(
      "src/app/(dashboard)/settings/channels/connect/[channel]/page.tsx",
      "utf8",
    )
    expect(connect).toContain(
      'isMetaOneClickGuide && mode === "existing" && metaFormInitialData',
    )
    expect(connect).toContain(
      'guide.formChannelId === "instagram" ? { igLogin: true }',
    )
  })

  it("does not promise an unimplemented deletion callback or account button", () => {
    for (const locale of LOCALES) {
      const deletion = JSON.parse(
        readFileSync("messages/" + locale + ".json", "utf8"),
      ).dataDeletion
      const text = Object.values(deletion).join(" ")
      expect(text).toContain("30")
      expect(text).toContain("400")
      expect(text).not.toMatch(/Meta callback/i)
      expect(text).not.toMatch(/Close Account/i)
    }
  })

  it("locks reviewer provisioning to the existing leaddrive sandbox", () => {
    const script = readFileSync("scripts/ensure-meta-review-user.mjs", "utf8")
    expect(script).toContain('const TENANT_SLUG = "leaddrive"')
    expect(script).toContain('const REVIEWER_EMAIL = "meta-review@leaddrivecrm.org"')
    expect(script).toContain('CONFIRM_PROD !== "meta-review:leaddrive"')
    expect(script).not.toContain("process.env.REVIEWER_EMAIL")
    expect(script).not.toContain("process.env.TENANT_SLUG")
  })
})
