import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const page = readFileSync(
  join(process.cwd(), "src/app/(dashboard)/social-monitoring/page.tsx"),
  "utf8",
)

describe("Brand Protection YouTube connection UI", () => {
  it("exposes the first-party OAuth flow from module settings", () => {
    expect(page).toContain('activeView === "settings" && (')
    expect(page).toContain('href="/api/v1/social/oauth/youtube/start"')
  })

  it("reports active state truthfully and offers reconnection for an existing account", () => {
    expect(page).toContain(
      'youtubeAccounts.some(a => a.isActive && Boolean(a.accessToken))',
    )
    expect(page).toContain('hasYouTubeAccount ? t("reconnectButton") : t("connectYoutube")')
    expect(page).toContain(
      'accounts.filter(a => a.platform === c.key && a.isActive && Boolean(a.accessToken))',
    )
    expect(page).toContain('const connected = a.isActive && Boolean(a.accessToken)')
    expect(page).toContain('a.platform === "youtube" && !connected')
  })
})
