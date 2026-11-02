// @vitest-environment jsdom
/**
 * The real ticket the prospect's own WhatsApp opened in LeadDrive's Service
 * Desk (owner, 2026-10-18: a ticket only on the prospect's own press), drawn
 * above the sample company's queue
 * (src/components/demo-center/journey/scenes/support-scene.tsx). The scene
 * draws it from its props alone — the page reads the thread once — in its
 * customer's view.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { act, createElement, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { SupportScene } from "@/components/demo-center/journey/scenes/support-scene"
import { DEMO_JOURNEY_STRINGS as S } from "@/components/demo-center/journey/strings"
import type { DemoSceneProps } from "@/components/demo-center/journey/scene-props"
import { createJourneySnapshot, findSection, PROSPECT_TO_CLOSED_WON, type DemoProspectIdentity } from "@/lib/demo-center/journey"
import type { DemoWhatsAppTicketView } from "@/lib/demo-center/demo-whatsapp-ticket-view"

const messages = JSON.parse(readFileSync(path.join(process.cwd(), "messages/az.json"), "utf8"))
const identity: DemoProspectIdentity = {
  name: "Nigar Əliyeva",
  company: "Xəzər Logistika MMC",
  jobTitle: "Satış direktoru",
  emailMasked: "n***@xezerlog.az",
  phoneMasked: "+994 ** *** 45 67",
  sourceChannel: "instagram",
  interests: ["service-desk"],
}

const TICKET: DemoWhatsAppTicketView = {
  number: "WA-0031",
  subject: "Kassa çeki çap etmir",
  status: "open",
  createdAt: "2026-10-18T11:01:00.000Z",
  sla: { kind: "firstResponse", dueAt: "2026-10-18T11:31:00.000Z" },
  messageCount: 7,
  messages: [
    { author: "customer", text: "Kassa çeki çap etmir", at: "2026-10-18T11:01:00.000Z" },
    { author: "assistant", text: "Printer siyahıda görünürmü?", at: "2026-10-18T11:01:10.000Z" },
    { author: "agent", text: "Baxıram, bir dəqiqə.", at: "2026-10-18T11:05:00.000Z" },
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

async function renderQueue(live: DemoSceneProps["live"], sectionId = "sd-queue") {
  const manifest = PROSPECT_TO_CLOSED_WON
  const props: DemoSceneProps = {
    manifest,
    snapshot: createJourneySnapshot(manifest, identity, new Date("2026-10-18T05:00:00.000Z")),
    section: findSection(manifest, sectionId)!,
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
      createElement(SupportScene, props),
    ))
  })
}

const card = () => container.querySelector<HTMLElement>('[data-testid="sd-live-ticket"]')

it("draws the real ticket above the sample queue from its props alone — in review too — in its customer's view", async () => {
  await renderQueue({ whatsappTicket: TICKET })
  const live = card()!
  expect(live.textContent).toContain(S.supportLiveTitle)
  expect(live.textContent).toContain("WA-0031")
  expect(live.textContent).toContain(messages.tickets.statusOpen)
  expect(live.textContent).toContain(messages.portal.serviceTarget)
  // Who wrote: the prospect as «Siz», the AI as the AI, a person on the team without a name.
  expect(live.textContent).toContain(S.supportLiveYou)
  expect(live.textContent).toContain(S.supportLiveAi)
  expect(live.textContent).toContain(S.supportLiveTeam)
  expect(live.textContent).toContain(S.supportLiveMore(4))
  // Above the sample company's counters.
  const kpis = container.querySelector('[data-tour-id="sd-queue-kpis"]')!
  expect(live.compareDocumentPosition(kpis) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

it("draws nothing without a ticket, or where the page reads no live thread", async () => {
  await renderQueue({ whatsappTicket: null })
  expect(card()).toBeNull()
  await renderQueue(undefined)
  expect(card()).toBeNull()
})

it("stays on every Service Desk screen — the sample queue's note only above the queue", async () => {
  await renderQueue({ whatsappTicket: TICKET }, "sd-rules")
  expect(card()!.textContent).toContain("WA-0031")
  expect(card()!.textContent).not.toContain(S.supportLiveNote)
})

