// @vitest-environment jsdom
/**
 * The prospect's own Facebook Page, once connected, as a real row on top of
 * the demo inbox (src/components/demo-center/journey/scenes/inbox-scene.tsx).
 * The scene draws it from its props alone — the page reads the Page once
 * (use-demo-live-social.ts) — and opens it read-only: the proven sender's
 * messages and the demo agent's answers, nothing else of the Page.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { act, createElement, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { InboxScene } from "@/components/demo-center/journey/scenes/inbox-scene"
import { DEMO_JOURNEY_STRINGS as S } from "@/components/demo-center/journey/strings"
import type { DemoSceneProps } from "@/components/demo-center/journey/scene-props"
import { createJourneySnapshot, findSection, PROSPECT_TO_CLOSED_WON, type DemoProspectIdentity } from "@/lib/demo-center/journey"
import type { DemoSocialInboxView } from "@/lib/demo-center/demo-social"

const messages = JSON.parse(readFileSync(path.join(process.cwd(), "messages/az.json"), "utf8"))
const identity: DemoProspectIdentity = {
  name: "Nigar Əliyeva",
  company: "Xəzər Logistika MMC",
  jobTitle: "Satış direktoru",
  emailMasked: "n***@xezerlog.az",
  phoneMasked: "+994 ** *** 45 67",
  sourceChannel: "instagram",
}

const PAGE: DemoSocialInboxView = {
  pageName: "Xəzər Logistika",
  code: "LD-9F8E7D",
  proven: true,
  messages: [
    { direction: "inbound", by: "prospect", text: "Salam, LD-9F8E7D", at: "2026-10-19T10:00:00.000Z" },
    { direction: "outbound", by: "ai", text: "Salam! Mən LeadDrive-ın demo AI agentiyəm.", at: "2026-10-19T10:00:04.000Z" },
  ],
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  document.body.innerHTML = ""
})

async function renderInbox(live: DemoSceneProps["live"]) {
  const manifest = PROSPECT_TO_CLOSED_WON
  const props: DemoSceneProps = {
    manifest,
    snapshot: createJourneySnapshot(manifest, identity, new Date("2026-10-19T05:00:00.000Z")),
    section: findSection(manifest, "conversation")!,
    step: null,
    reviewMode: true,
    variant: "granted",
    dispatch: vi.fn() as never,
    hint: vi.fn(),
    live,
  }
  await act(async () => {
    root.render(createElement(
      NextIntlClientProvider,
      { locale: "az", messages, timeZone: "Asia/Baku" } as ComponentProps<typeof NextIntlClientProvider>,
      createElement(InboxScene, props),
    ))
  })
}

const rows = () => [...container.querySelectorAll<HTMLButtonElement>("[data-inbox-row]")]

it("puts the connected Page on top of the list as a live Facebook row", async () => {
  await renderInbox({ whatsappTicket: null, social: PAGE })
  const first = rows()[0]
  expect(first.dataset.inboxRow).toBe("live-facebook")
  expect(first.textContent).toContain(S.socialInboxContact("Xəzər Logistika"))
  expect(first.textContent).toContain("Mən LeadDrive-ın demo AI agentiyəm")
  expect(first.querySelector('[data-testid="demo-inbox-live-badge"]')!.textContent).toBe(S.socialInboxLive)
})

it("opens it read-only: the proven sender's words, the agent's answers marked as AI, and what the row is", async () => {
  await renderInbox({ whatsappTicket: null, social: PAGE })
  await act(async () => rows()[0].click())
  const thread = container.querySelector<HTMLElement>('[data-testid="demo-inbox-live-thread"]')!
  expect(thread.textContent).toContain("Salam, LD-9F8E7D")
  expect(thread.textContent).toContain(messages.inboxV2.messageAuthorAi)
  expect(container.textContent).toContain(S.socialInboxNote)
  expect(container.querySelector("textarea")).toBeNull()
})

it("before anyone wrote with the code, the row says how to", async () => {
  await renderInbox({ whatsappTicket: null, social: { ...PAGE, proven: false, messages: [] } })
  expect(rows()[0].textContent).toContain(S.socialInboxWaiting("LD-9F8E7D"))
})

it("has no live row without a connected Page", async () => {
  await renderInbox({ whatsappTicket: null, social: null })
  expect(rows().some((row) => row.dataset.inboxRow === "live-facebook")).toBe(false)
  await renderInbox(undefined)
  expect(rows().some((row) => row.dataset.inboxRow === "live-facebook")).toBe(false)
})
