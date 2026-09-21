// @vitest-environment jsdom

import { readFileSync } from "node:fs"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { UserTwoFactorControls, type UserTwoFactorUpdate } from "@/components/settings/user-two-factor-controls"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

/**
 * Settings → Users showed the "Require 2FA" switch ON whenever a factor was
 * enrolled and saved the opposite of what it showed, so mandatory 2FA could
 * not be switched on for a user who already had an authenticator.
 */
const NO_2FA = { require2fa: false, totpEnabled: false, smsAuthEnabled: false, verifiedPhone: null as string | null }

let container: HTMLDivElement
let root: Root

async function renderControls(user: typeof NO_2FA) {
  const onUpdate = vi.fn<(update: UserTwoFactorUpdate) => void>()
  await act(async () => {
    root.render(createElement(UserTwoFactorControls, { user, onUpdate }))
  })
  return onUpdate
}

function requireSwitch(): HTMLButtonElement {
  const element = container.querySelector<HTMLButtonElement>('[data-testid="user-require-2fa-switch"]')
  if (!element) throw new Error("Require 2FA switch is not rendered")
  return element
}

function setupStatus(): string | null {
  return container.querySelector('[data-testid="user-2fa-status"]')?.textContent ?? null
}

async function clickSwitch() {
  await act(async () => {
    requireSwitch().click()
  })
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe("Settings → Users: Require 2FA switch", () => {
  it("shows OFF with a configured badge for an enrolled user without the requirement, and saves ON", async () => {
    const onUpdate = await renderControls({ ...NO_2FA, totpEnabled: true })

    expect(requireSwitch().getAttribute("role")).toBe("switch")
    expect(requireSwitch().getAttribute("aria-checked")).toBe("false")
    expect(requireSwitch().className).toContain("bg-muted-foreground/40")
    expect(setupStatus()).toBe("twoFactorConfigured")

    await clickSwitch()
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledWith({ require2fa: true })
  })

  it("shows ON when 2FA is required and saves OFF", async () => {
    const onUpdate = await renderControls({ ...NO_2FA, require2fa: true, totpEnabled: true })

    expect(requireSwitch().getAttribute("aria-checked")).toBe("true")
    expect(requireSwitch().className).toContain("bg-green-500")
    expect(setupStatus()).toBe("twoFactorConfigured")

    await clickSwitch()
    expect(onUpdate).toHaveBeenCalledWith({ require2fa: false })
  })

  it("marks a requirement without any factor as set up at the next login", async () => {
    const onUpdate = await renderControls({ ...NO_2FA, require2fa: true })

    expect(requireSwitch().getAttribute("aria-checked")).toBe("true")
    expect(setupStatus()).toBe("twoFactorSetupPending")

    await clickSwitch()
    expect(onUpdate).toHaveBeenCalledWith({ require2fa: false })
  })

  it("turns the requirement on for a user without a factor exactly as before", async () => {
    const onUpdate = await renderControls(NO_2FA)

    expect(requireSwitch().getAttribute("aria-checked")).toBe("false")
    expect(setupStatus()).toBeNull()

    await clickSwitch()
    expect(onUpdate).toHaveBeenCalledWith({ require2fa: true })
  })

  it("does not call an SMS factor without a verified phone configured, nor let it move the switch", async () => {
    await renderControls({ ...NO_2FA, smsAuthEnabled: true })
    expect(requireSwitch().getAttribute("aria-checked")).toBe("false")
    expect(setupStatus()).toBeNull()

    await renderControls({ ...NO_2FA, smsAuthEnabled: true, verifiedPhone: "+994000000000" })
    expect(requireSwitch().getAttribute("aria-checked")).toBe("false")
    expect(setupStatus()).toBe("twoFactorConfigured")
  })

  it("is what the users table renders, and the table no longer derives the switch from enrollment", () => {
    const page = readFileSync("src/app/(dashboard)/settings/users/page.tsx", "utf8")
    expect(page).toContain("<UserTwoFactorControls user={item} onUpdate={(update) => updateUserTwoFactor(item.id, update)} />")
    expect(page).toContain("body: JSON.stringify(update),")
    expect(page).not.toContain("anyMethodActive")
    expect(page).not.toMatch(/require2fa\s*\|\|/)
  })

  it("localizes the setup status in every locale", () => {
    const missing: string[] = []
    for (const locale of ["az", "ru", "en"]) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).settingsUsers
      for (const key of ["twoFactorConfigured", "twoFactorSetupPending", "require2faTooltip"]) {
        if (typeof messages?.[key] !== "string" || !messages[key].trim()) missing.push(`${locale}.settingsUsers.${key}`)
      }
    }
    expect(missing).toEqual([])
  })
})
