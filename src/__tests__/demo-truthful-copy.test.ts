/**
 * The demo says only what the product does.
 *
 * Owner, 2026-10-17, after the module study: the demo had drifted from the
 * product it sells — an «ƏDV 18%» line the product's quote has not got, a
 * conversion estimate made up as score × 0.6, a «Lidlər» funnel step no lead
 * feeds, and AI replies naming «sabah 11:00» and «they will call you today»,
 * the very sentences the product's AI is forbidden to send. Each of these is
 * what a buyer checks first on a real account. These tests hold the demo to
 * the product's own rules, read from the product's own code.
 */
import { describe, expect, it, vi } from "vitest"
import { guardOmnichannelCommitments } from "@/lib/inbox/omnichannel-commitment-rules"
import { QUALIFICATION_CHECKLIST } from "@/lib/inbox/lead-qualification"
import { QUOTE_TRANSITIONS } from "@/lib/cpq/types"
import { DEFAULT_PIPELINE_STAGES } from "@/lib/constants"
import {
  DEMO_DEAL_STAGES,
  DEMO_INBOX_THREADS,
  DEMO_QUALIFICATION_CHECKLIST,
  DEMO_SAMPLE_CAMPAIGNS,
  DEMO_SOURCE_CHANNELS,
  PROSPECT_TO_CLOSED_WON,
  createJourneyRecords,
  demoInboxChannelOf,
  rebuildRecordsAtState,
  type DemoProspectIdentity,
} from "@/lib/demo-center/journey"
import { DEMO_JOURNEY_HAPPY_PATH } from "@/lib/demo-center/journey/state"
import { SUPPORT_DEMO_DRAFT } from "@/components/demo-center/journey/scenes/support-demo-data"

// The checklist lives next to the code that writes it to the database; only the constant is read here.
vi.mock("@/lib/prisma", () => ({ prisma: {}, logAudit: vi.fn() }))

const NOW = new Date("2026-10-17T09:00:00.000Z")
const identityFor = (sourceChannel: DemoProspectIdentity["sourceChannel"]): DemoProspectIdentity => ({
  name: "Nigar Əliyeva",
  company: "Xəzər Logistika MMC",
  jobTitle: "Satış direktoru",
  emailMasked: "n***@xezerlog.az",
  phoneMasked: "+994 ** *** 45 67",
  sourceChannel,
})

describe("the demo's AI agent obeys the product's commitment rules", () => {
  const aiLines = [
    ...DEMO_INBOX_THREADS.flatMap((thread) => thread.messages.filter((message) => message.from === "ai").map((message) => ({ where: thread.id, text: message.text }))),
    ...DEMO_SOURCE_CHANNELS.map((channel) => ({ where: `draft (${channel})`, text: createJourneyRecords(identityFor(channel), NOW).conversation.aiDraft!.text })),
    // Service Desk: the reply Da Vinci drafts on the ticket.
    { where: "service desk draft", text: SUPPORT_DEMO_DRAFT },
  ]

  it.each(aiLines)("$where passes the guard untouched", ({ text }) => {
    const guarded = guardOmnichannelCommitments(text, { locale: "az" })
    expect(guarded.violations).toEqual([])
    expect(guarded.text).toBe(text)
  })
})

describe("no channel the product does not offer customers", () => {
  it("shows no Instagram conversation while Meta has not approved Direct", () => {
    expect(DEMO_INBOX_THREADS.filter((thread) => thread.channel === "instagram")).toEqual([])
    for (const channel of DEMO_SOURCE_CHANNELS) expect(demoInboxChannelOf(channel)).not.toBe("instagram")
  })

  it("sends campaigns only the way the product sends them", () => {
    const sendable = new Set(["email", "sms", "whatsapp", "telegram"])
    for (const sample of DEMO_SAMPLE_CAMPAIGNS) expect(sendable.has(sample.type), sample.name).toBe(true)
    for (const channel of DEMO_SOURCE_CHANNELS) {
      expect(sendable.has(createJourneyRecords(identityFor(channel), NOW).campaign.type), channel).toBe(true)
    }
  })
})

describe("the quote, the deal and the task follow the product", () => {
  const done = rebuildRecordsAtState(identityFor("website"), "CLOSED_WON", NOW, DEMO_JOURNEY_HAPPY_PATH)

  it("has no tax line and the deal keeps one number from the lead to the win", () => {
    expect(Object.keys(done.quote!)).not.toContain("vatPercent")
    const total = done.quote!.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0)
    expect(total).toBe(done.lead!.estimatedValue)
    expect(done.deal!.amount).toBe(done.lead!.estimatedValue)
  })

  it("reaches «accepted» only through «viewed», and accepting opens a draft contract", () => {
    expect(QUOTE_TRANSITIONS.sent).not.toContain("accepted")
    expect(QUOTE_TRANSITIONS.viewed).toContain("accepted")
    expect(done.quote!.viewedAt).not.toBeNull()
    expect(done.quote!.contractNumber).toMatch(new RegExp(`^${done.quote!.quoteNumber}-CTR-`))
  })

  it("uses the default pipeline's probabilities", () => {
    for (const stage of DEMO_DEAL_STAGES) {
      const product = DEFAULT_PIPELINE_STAGES.find((candidate) => candidate.name.toLowerCase() === stage.key)
      expect(product?.probability, stage.key).toBe(stage.probability)
    }
  })

  it("gives the board task the checklist the product's AI writes", () => {
    expect([...DEMO_QUALIFICATION_CHECKLIST]).toEqual([...QUALIFICATION_CHECKLIST])
    expect(done.task!.checklist.slice(0, QUALIFICATION_CHECKLIST.length)).toEqual([...QUALIFICATION_CHECKLIST])
    expect(done.task!.checklist).toHaveLength(QUALIFICATION_CHECKLIST.length + 2)
  })
})

describe("the guide's words", () => {
  const texts = PROSPECT_TO_CLOSED_WON.sections.flatMap((section) => [
    section.title,
    section.summary,
    ...section.steps.flatMap((step) => [step.title, step.instruction, step.result ?? "", step.targetLabel ?? ""]),
  ])

  it("claims none of the things the product does not do", () => {
    const untrue = [
      /ƏDV/, // the quote has no tax line
      /linkdən/, // there is no page where the customer accepts a quote
      /Heç nə nəzarətsiz/, // drafts are one of three modes per channel
      /«Lidlər» sətr/, // the campaign funnel has no leads step
      /hər lidi kampaniyaya/,
      /qısa baxış/, // the deal opens its page; there is no quick-view sheet
      /Kvalifikasiyadan sonra sistem/, // a manual qualification creates no task
      /Instagram/, // not offered to customers while Meta has not approved it
    ]
    for (const text of texts) for (const pattern of untrue) expect(text, `«${text}»`).not.toMatch(pattern)
  })
})
