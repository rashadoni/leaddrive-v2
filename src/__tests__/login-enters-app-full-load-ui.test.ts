// @vitest-environment jsdom
/**
 * Entering the CRM from a sign-in page must load a new document.
 *
 * The sign-in pages are served with `microphone=()`, and a client-side
 * navigation keeps the document's policy, so `router.push("/")` left everyone
 * who had just signed in without a microphone until they reloaded (2026-11-22).
 * The real pages, on real React; only the session and the network are stubbed.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { enterSignedInApp } from "@/lib/enter-signed-in-app"

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const stubs = vi.hoisted(() => ({
  enter: vi.fn(),
  update: vi.fn(async () => ({})),
  session: { user: {} } as { user: Record<string, unknown> },
}))

vi.mock("@/lib/enter-signed-in-app", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/enter-signed-in-app")>(),
  enterSignedInApp: stubs.enter,
}))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: stubs.session, update: stubs.update }) }))
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => `auth.${key}` }))

let container: HTMLDivElement
let root: Root

async function settle() {
  for (let turn = 0; turn < 10; turn += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  }
}

async function open(page: () => Promise<{ default: () => React.ReactNode }>) {
  const { default: Page } = await page()
  await act(async () => { root.render(createElement(Page)) })
  await settle()
}

beforeEach(() => {
  stubs.enter.mockClear()
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { twoFactorNonce: "nonce", qrCode: "", secret: "" } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })))
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

describe("entering the CRM from a sign-in page", () => {
  it("is a page load of the CRM's root", async () => {
    const { enterSignedInApp: real } = await vi.importActual<typeof import("@/lib/enter-signed-in-app")>("@/lib/enter-signed-in-app")
    const assign = vi.fn()
    real({ assign })
    expect(assign).toHaveBeenCalledExactlyOnceWith("/")
    expect(enterSignedInApp).toBe(stubs.enter)
  })

  it("after the second factor", async () => {
    stubs.session = { user: { needs2fa: true, twoFactorMethod: "totp" } }
    await open(() => import("@/app/(auth)/login/verify-2fa/page"))
    expect(stubs.enter).not.toHaveBeenCalled()

    const input = container.querySelector("input")!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "123456")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })
    await settle()
    expect(stubs.update).toHaveBeenCalled()
    expect(stubs.enter).toHaveBeenCalledTimes(1)
  })

  it("from the second-factor page when the session no longer needs it", async () => {
    stubs.session = { user: { needs2fa: false } }
    await open(() => import("@/app/(auth)/login/verify-2fa/page"))
    expect(stubs.enter).toHaveBeenCalled()
  })

  it("from the 2FA setup page when the session no longer needs it", async () => {
    stubs.session = { user: { needsSetup2fa: false } }
    await open(() => import("@/app/(auth)/login/setup-2fa/page"))
    expect(stubs.enter).toHaveBeenCalled()
  })

  it("no sign-in page goes into the CRM by client-side navigation", () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const file = path.join(dir, name)
        if (statSync(file).isDirectory()) walk(file)
        else if (file.endsWith(".tsx")) files.push(file)
      }
    }
    walk(path.join(process.cwd(), "src/app/(auth)"))
    expect(files.length).toBeGreaterThan(3)
    for (const file of files) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/router\.(push|replace)\(\s*["'`]\/(dashboard)?["'`]/)
    }
  })
})
