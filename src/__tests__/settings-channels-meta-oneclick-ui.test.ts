// @vitest-environment jsdom

import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  act,
  cloneElement,
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The Meta channels connect the way Social Monitoring does: one icon, one click, done — and the UI
 * must never claim a channel is connected when nothing can reach Inbox through it.
 *
 * This file used to be nine `readFileSync(...).toContain("<source substring>")` assertions. That
 * shape cannot fail for any input, only for an edit: it froze the wording of the very predicate an
 * adversarial review then found wrong in four places (a switched-off row, a row whose Meta subscribe
 * failed, the "other connected channels" list, and the "N active" counter all still said
 * "Connected"). Every check below now MOUNTS the real component and reads the rendered DOM, so it
 * fails when the screen lies, not when the source is reworded.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => {
    const translate = (key: string) => key
    translate.has = () => false
    return translate
  },
}))

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { organizationId: "org-1", organizationSlug: "acme" } },
  }),
}))

vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) =>
    createElement("a", props, children),
}))

vi.mock("@/components/tour/tour-provider", () => ({
  useAutoTour: () => undefined,
}))

vi.mock("@/components/tour/tour-replay-button", () => ({
  TourReplayButton: () => null,
}))

vi.mock("@/components/help/help-button", () => ({
  HelpButton: () => null,
}))

vi.mock("@/components/delete-confirm-dialog", () => ({
  DeleteConfirmDialog: () => null,
}))

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
    open ? createElement("div", null, children) : null,
  DialogContent: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  DialogHeader: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  DialogTitle: ({ children }: { children?: ReactNode }) => createElement("h2", null, children),
  DialogFooter: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
}))

vi.mock("@/components/ui/button", () => ({
  Button: ({
    asChild,
    children,
    variant: _variant,
    size: _size,
    ...props
  }: {
    asChild?: boolean
    children?: ReactNode
    variant?: string
    size?: string
    [key: string]: unknown
  }) => {
    void _variant
    void _size
    if (asChild && isValidElement(children)) {
      return cloneElement(children as ReactElement<Record<string, unknown>>, props)
    }
    return createElement("button", props, children)
  },
}))

// The REAL form, deliberately unmocked: the catalog renders it closed (the Dialog mock above drops
// closed dialogs), and the second describe below mounts it open to check that both screens describe a
// row the same way.
import ChannelsPage from "@/app/(dashboard)/settings/channels/page"
import { ChannelConfigForm } from "@/components/channel-config-form"

/** jsdom ships no matchMedia; the catalog reads prefers-reduced-motion for its tutorial autoplay. */
function stubMatchMedia() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }))
}

type ApiChannel = {
  id: string
  channelType: string
  configName: string
  pageId?: string | null
  isActive: boolean
  settings?: Record<string, unknown> | null
  hasAccessToken?: boolean
  claimedElsewhere?: boolean
}

/** A page row exactly as the OAuth callback + publicChannelConfig produce it. */
const wiredFacebookPage: ApiChannel = {
  id: "fb-page",
  channelType: "facebook",
  configName: "Acme Page",
  pageId: "1122334455",
  isActive: true,
  hasAccessToken: true,
  settings: { inboxSubscribed: true },
}

async function flushMicrotasks(rounds = 12): Promise<void> {
  await act(async () => {
    for (let index = 0; index < rounds; index += 1) {
      await Promise.resolve()
    }
  })
}

describe("Channel catalog — what the screen claims about a Meta channel", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    stubMatchMedia()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function renderCatalog(channels: ApiChannel[]) {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: channels }),
    })))
    await act(async () => {
      root.render(createElement(ChannelsPage))
    })
    await flushMicrotasks()
  }

  const card = (id: string) =>
    container.querySelector<HTMLElement>(`[data-testid="channel-card-${id}"]`)
  const connectedBadge = (id: string) =>
    card(id)?.querySelector<HTMLElement>('[data-testid="channel-card-connected-badge"]') || null
  const brokenBadge = (id: string) =>
    card(id)?.querySelector<HTMLElement>('[data-testid="channel-card-broken-badge"]') || null
  const oauthLink = (id: string) =>
    card(id)?.querySelector<HTMLAnchorElement>('a[href^="/api/v1/social/oauth/"]') || null
  const activeCount = () =>
    container.querySelector<HTMLElement>('[data-testid="channels-active-count"]')?.textContent || ""

  it("calls a fully wired page connected", async () => {
    await renderCatalog([wiredFacebookPage])
    expect(connectedBadge("facebook")?.textContent).toContain("Connected")
    expect(brokenBadge("facebook")).toBeNull()
    expect(activeCount()).toContain("1 active")
  })

  it("does NOT call a bare saved row connected, and keeps the way back into OAuth", async () => {
    // What the channel form alone produces: a name, isActive true, and nothing that delivers.
    await renderCatalog([{
      id: "fb-draft",
      channelType: "facebook",
      configName: "Facebook Messenger",
      isActive: true,
      hasAccessToken: false,
    }])
    expect(connectedBadge("facebook")).toBeNull()
    expect(brokenBadge("facebook")?.textContent).toContain("Draft")
    // Regression guard: the `connected ?` branch once sat above the OAuth branch, so a draft row hid
    // the only route back to the Meta dialog and the card became a dead end.
    expect(oauthLink("facebook")?.getAttribute("href"))
      .toBe("/api/v1/social/oauth/facebook/start?from=channels-facebook")
    expect(activeCount()).toContain("0 active")
  })

  it("does not call a page connected when Meta refused the message subscription", async () => {
    // ensureInboxChannelForPage writes settings.inboxSubscribed=false when subscribed_apps fails
    // (typically a missing pages_messaging scope). The row is wired; not one DM will ever arrive.
    await renderCatalog([{ ...wiredFacebookPage, settings: { inboxSubscribed: false } }])
    expect(connectedBadge("facebook")).toBeNull()
    expect(brokenBadge("facebook")?.textContent).toContain("Reconnect needed")
    expect(activeCount()).toContain("0 active")
  })

  it("does not call a switched-off page connected", async () => {
    // webhooks/facebook resolves inbound DMs with `isActive: true` — an off row is invisible to it.
    await renderCatalog([{ ...wiredFacebookPage, isActive: false }])
    expect(connectedBadge("facebook")).toBeNull()
    expect(brokenBadge("facebook")?.textContent).toContain("Switched off")
    expect(activeCount()).toContain("0 active")
  })

  it("does not demote a legacy row that predates the inboxSubscribed flag", async () => {
    // Rows wired before the flag existed carry no flag at all. Reading "absent" as "failed" would
    // turn every one of them into a draft overnight — the same class of lie, pointing the other way.
    const { settings: _settings, ...legacyRow } = wiredFacebookPage
    void _settings
    await renderCatalog([legacyRow])
    expect(connectedBadge("facebook")?.textContent).toContain("Connected")
    expect(brokenBadge("facebook")).toBeNull()
  })

  it("keeps a Model B tenant's leftover config row out of the connected list", async () => {
    // A tenant running its own Meta app holds TWO facebook rows: the app-config row (appId/appSecret,
    // no page) and the page row OAuth wrote. The card describes the delivering one; the other lands in
    // "Other connected channels", which used to badge EVERY row "Connected" unconditionally.
    await renderCatalog([
      { id: "fb-config", channelType: "facebook", configName: "Own Meta app", isActive: true, hasAccessToken: false },
      wiredFacebookPage,
    ])
    expect(connectedBadge("facebook")?.textContent).toContain("Connected")
    const leftover = container.querySelector<HTMLElement>('[data-testid="channel-row-fb-config"]')
    expect(leftover).not.toBeNull()
    expect(leftover?.querySelector('[data-testid="channel-row-connected-badge"]')).toBeNull()
    expect(
      leftover?.querySelector<HTMLElement>('[data-testid="channel-row-broken-badge"]')?.textContent,
    ).toContain("Draft")
    // Exactly one of the two rows is a working connection.
    expect(activeCount()).toContain("1 active")
  })

  it("does not call a page connected when another workspace's older claim receives its messages", async () => {
    // 2026-09-11: Fanumsec's card said «Подключено» while the webhook delivered every DM to the workspace
    // that had claimed the same account in June. The API marks such a row `claimedElsewhere` — a boolean,
    // never who — and the card must send the user to support rather than to a button that cannot help.
    await renderCatalog([{ ...wiredFacebookPage, claimedElsewhere: true }])
    expect(connectedBadge("facebook")).toBeNull()
    expect(brokenBadge("facebook")?.textContent).toContain("channelClaimedElsewhere.badge")
    expect(card("facebook")?.textContent).toContain("channelClaimedElsewhere.status")
    expect(card("facebook")?.textContent).toContain("channelClaimedElsewhere.hint")
    expect(activeCount()).toContain("0 active")
  })

  it("does not badge a claimed-elsewhere page in the other-channels list connected", async () => {
    // Prod today: one workspace holds several Messenger pages, some of which an older workspace also claims.
    await renderCatalog([
      wiredFacebookPage,
      { ...wiredFacebookPage, id: "fb-contested", configName: "Contested Page", pageId: "5566778899", claimedElsewhere: true },
    ])
    expect(connectedBadge("facebook")?.textContent).toContain("Connected")
    const contested = container.querySelector<HTMLElement>('[data-testid="channel-row-fb-contested"]')
    expect(contested).not.toBeNull()
    expect(contested?.querySelector('[data-testid="channel-row-connected-badge"]')).toBeNull()
    expect(
      contested?.querySelector<HTMLElement>('[data-testid="channel-row-broken-badge"]')?.textContent,
    ).toContain("channelClaimedElsewhere.badge")
    expect(activeCount()).toContain("1 active")
  })

  it("still treats a non-Meta row as connected on the strength of the row alone", async () => {
    // The credential rule is Meta-specific: for Telegram the saved row IS the credential set.
    await renderCatalog([{
      id: "tg",
      channelType: "telegram",
      configName: "Telegram Bot",
      isActive: true,
      hasAccessToken: true,
    }])
    expect(connectedBadge("telegram")?.textContent).toContain("Connected")
    expect(brokenBadge("telegram")).toBeNull()
    expect(activeCount()).toContain("1 active")
  })

  it("does not call a switched-off telegram row connected either", async () => {
    // The switch is NOT a Meta rule: webhooks/telegram resolves the bot with `isActive: true`, so an
    // off row drops every inbound message just like an off Page row. The card used to badge it
    // "Connected" while the counter in the header said "0 active" — one screen, two answers.
    await renderCatalog([{
      id: "tg-off",
      channelType: "telegram",
      configName: "Telegram Bot",
      isActive: false,
      hasAccessToken: true,
    }])
    expect(connectedBadge("telegram")).toBeNull()
    expect(brokenBadge("telegram")?.textContent).toContain("Switched off")
    expect(activeCount()).toContain("0 active")
  })

  it("does not badge a switched-off row in the other-channels list connected", async () => {
    // The card shows the delivering row; the leftover falls through to "Other connected channels",
    // which is the second place the same claim gets made.
    await renderCatalog([
      { id: "tg-live", channelType: "telegram", configName: "Support bot", isActive: true, hasAccessToken: true },
      { id: "tg-off", channelType: "telegram", configName: "Old bot", isActive: false, hasAccessToken: true },
    ])
    expect(connectedBadge("telegram")?.textContent).toContain("Connected")
    const leftover = container.querySelector<HTMLElement>('[data-testid="channel-row-tg-off"]')
    expect(leftover).not.toBeNull()
    expect(leftover?.querySelector('[data-testid="channel-row-connected-badge"]')).toBeNull()
    expect(
      leftover?.querySelector<HTMLElement>('[data-testid="channel-row-broken-badge"]')?.textContent,
    ).toContain("Switched off")
    expect(activeCount()).toContain("1 active")
  })

  it("explains a switched-off channel without inventing a Facebook Page for it", async () => {
    // The paused hint is now shown for every channel type, so it may not describe a Page and a page
    // token the tenant never had.
    await renderCatalog([{
      id: "tg-off",
      channelType: "telegram",
      configName: "Telegram Bot",
      isActive: false,
      hasAccessToken: true,
    }])
    const hint = card("telegram")?.textContent || ""
    expect(hint).toContain("switched off")
    expect(hint).not.toContain("Page and its token")
  })

  it("keeps Model A at one click and starts Instagram through the Facebook flow", async () => {
    await renderCatalog([])
    // One click, straight from the card, for a tenant with nothing configured yet.
    expect(oauthLink("facebook")?.getAttribute("href"))
      .toBe("/api/v1/social/oauth/facebook/start?from=channels-facebook")
    // Instagram Direct rides the LINKED Page's messages webhook, and only the facebook callback wires
    // a ChannelConfig for it, so the Instagram card deliberately starts the facebook flow.
    expect(oauthLink("instagram")?.getAttribute("href"))
      .toBe("/api/v1/social/oauth/facebook/start?from=channels-instagram")
    expect(connectedBadge("facebook")).toBeNull()
    expect(container.querySelector('[data-testid="channel-card-connected-badge"]')).toBeNull()
  })
})

describe("Channel form — what it tells the user about the same row", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    stubMatchMedia()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ providers: { facebook: true, instagram: true } }),
    })))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function renderForm(initialData: Record<string, unknown>) {
    await act(async () => {
      root.render(createElement(ChannelConfigForm, {
        open: true,
        variant: "inline",
        onOpenChange: vi.fn(),
        onSaved: vi.fn(),
        orgId: "org-1",
        lockChannelType: true,
        initialData,
      }))
    })
    await flushMicrotasks()
  }

  const stateText = () =>
    container.querySelector<HTMLElement>('[data-testid="meta-connection-state"]')?.textContent || ""
  const connectButton = () =>
    container.querySelector<HTMLButtonElement>('[data-testid="meta-oauth-connect"]')

  it("agrees with the catalog on every connection state", async () => {
    // One predicate, two screens. When these two disagree the user is told two different things about
    // the same row depending on where they look.
    await renderForm({ id: "fb", channelType: "facebook", configName: "Acme", pageId: "1122334455", isActive: true, hasAccessToken: true, settings: { inboxSubscribed: true } })
    expect(stateText()).toContain("Connected.")
    expect(stateText()).toContain("1122334455")

    await renderForm({ id: "fb", channelType: "facebook", configName: "Acme", isActive: true, hasAccessToken: false })
    expect(stateText()).toContain("Not connected.")

    await renderForm({ id: "fb", channelType: "facebook", configName: "Acme", pageId: "1122334455", isActive: false, hasAccessToken: true })
    expect(stateText()).toContain("switched off")

    await renderForm({ id: "fb", channelType: "facebook", configName: "Acme", pageId: "1122334455", isActive: true, hasAccessToken: true, settings: { inboxSubscribed: false } })
    expect(stateText()).toContain("Meta refused the message subscription")

    await renderForm({ id: "fb", channelType: "facebook", configName: "Acme", pageId: "1122334455", isActive: true, hasAccessToken: true, settings: { inboxSubscribed: true }, claimedElsewhere: true })
    expect(stateText()).toBe("channelClaimedElsewhere.reason")
  })

  it("holds a save whose account is claimed by another workspace on screen until the user acknowledges it", async () => {
    // The connect page navigates to the catalog on save; the warning must not flash by on the way out.
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        providers: { facebook: true, instagram: true },
        success: true,
        data: { id: "fb", channelType: "facebook", pageId: "1122334455", isActive: true, claimedElsewhere: true },
      }),
    })))
    const onSaved = vi.fn()
    const onOpenChange = vi.fn()
    await act(async () => {
      root.render(createElement(ChannelConfigForm, {
        open: true,
        variant: "inline",
        onOpenChange,
        onSaved,
        orgId: "org-1",
        lockChannelType: true,
        initialData: { id: "fb", channelType: "facebook", configName: "Acme", pageId: "1122334455", isActive: true, hasAccessToken: true },
      }))
    })
    await flushMicrotasks()
    const form = container.querySelector("form")
    expect(form).not.toBeNull()
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })
    await flushMicrotasks()

    const warning = container.querySelector<HTMLElement>('[data-testid="channel-claimed-elsewhere-warning"]')
    expect(warning?.textContent).toContain("channelClaimedElsewhere.savedTitle")
    expect(warning?.textContent).toContain("channelClaimedElsewhere.hint")
    expect(onSaved).not.toHaveBeenCalled()
    // The row already exists, so a second submit is not offered — it would create a duplicate.
    expect(container.querySelector("#channelSubmitButton")).toBeNull()

    const acknowledge = [...container.querySelectorAll("button")].find((b) => b.textContent === "channelClaimedElsewhere.acknowledge")
    await act(async () => {
      acknowledge?.click()
    })
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("asks a Model A tenant for no Meta secrets at all", async () => {
    await renderForm({ channelType: "facebook", configName: "Facebook Messenger", isActive: true })
    // One enabled button, no credentials demanded before it can be pressed.
    expect(connectButton()?.disabled).toBe(false)
    for (const id of ["appId", "appSecret", "verifyToken"]) {
      const field = container.querySelector<HTMLInputElement>(`#${id}`)
      expect(field, `${id} must still exist for Model B`).not.toBeNull()
      // A native `required` inside the collapsed <details> makes Chrome abort submit with an
      // "invalid form control is not focusable" console error and no visible message.
      expect(field?.required, `${id} must not be required`).toBe(false)
    }
  })

  it("blocks OAuth for an own-app tenant whose App ID is not saved", async () => {
    // Model B: the start/callback routes resolve the tenant's Meta app from the DB, so connecting with
    // an unsaved App ID would silently run against the stored (stale) one.
    await renderForm({
      id: "fb-own",
      channelType: "facebook",
      configName: "Own Meta app",
      isActive: true,
      hasAppSecret: true,
      hasVerifyToken: true,
    })
    expect(connectButton()?.disabled).toBe(true)
    expect(container.textContent).toContain("App ID is not saved")
  })

  it("leaves Model A one click even when the workspace has never saved anything", async () => {
    await renderForm({ channelType: "instagram", configName: "Instagram Direct", isActive: true })
    expect(connectButton()?.disabled).toBe(false)
    expect(stateText()).toContain("Not connected yet.")
  })
})

/**
 * The remaining source-level checks. Both are about code paths with no runtime harness here: the
 * OAuth start route runs behind `withSocialConnectAuth` (a session + org gate), and the setup-step
 * copy is data, not behaviour. They are ratchets on purpose, and they say so.
 */
describe("Meta one-click — checks with no executable surface", () => {
  it("requests the inbox scopes on a first connect started from the channels screen", () => {
    // Without this the first one-click connect asks for monitoring scopes only, the page-messages
    // subscription fails, and the channel looks connected while the inbox stays empty forever.
    const facebookStart = readFileSync(
      join(process.cwd(), "src/app/api/v1/social/oauth/facebook/start/route.ts"),
      "utf8",
    )
    expect(facebookStart).toContain("const usesSocialInbox = Boolean(returnKey) ||")
  })

  it("no longer sells step 3 as just save it", () => {
    for (const locale of ["en", "ru", "az"] as const) {
      const messages = JSON.parse(
        readFileSync(join(process.cwd(), `messages/${locale}.json`), "utf8"),
      ) as { forms: Record<string, string> }
      const step3 = messages.forms.channelSetupMeta3
      expect(step3).toBeTruthy()
      expect(step3).not.toMatch(/^(Save the channel|Сохраните канал|Kanalı saxlayın)/)
    }
  })
})
