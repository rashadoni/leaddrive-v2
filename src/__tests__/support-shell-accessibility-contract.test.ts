import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const rootLayout = readFileSync("src/app/layout.tsx", "utf8")
const sidebar = readFileSync("src/components/sidebar.tsx", "utf8")
const dashboard = readFileSync("src/app/(dashboard)/layout.tsx", "utf8")

describe("Support shell accessibility and entitlement contract", () => {
  it("keeps browser zoom available and exposes the active locale", () => {
    expect(rootLayout).not.toContain("maximumScale")
    expect(rootLayout).toContain("const locale = await getLocale()")
    expect(rootLayout).toContain('<html lang={locale}')
    expect(rootLayout).not.toContain('body className="font-sans antialiased" nonce={nonce}')
  })

  it("names the sidebar collapse control", () => {
    expect(sidebar).toContain('aria-label={collapsed ? t("expand") : t("collapse")}')
    expect(sidebar).toContain('title={collapsed ? t("expand") : t("collapse")}')
  })

  it("does not poll disabled module APIs from every dashboard page", () => {
    expect(sidebar).toContain('const webChatEnabled = accessibleItems.some')
    expect(sidebar).toContain("if (webChatEnabled)")
    expect(dashboard).toContain("mtmSyncEnabled")
    expect(dashboard).toContain('status === "authenticated" && mtmSyncEnabled')
  })
})
