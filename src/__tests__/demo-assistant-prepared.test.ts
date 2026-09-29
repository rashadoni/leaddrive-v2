/**
 * The demo assistant answers from prepared, approved text when a decision
 * model (Jev) is sure which answer a question needs — and asks Da Vinci
 * exactly as before whenever it is not (owner, 2026-09-29).
 *
 * Behaviour through the real route: the grant lookup, Jev's HTTP answer and
 * the Claude call are stand-ins; the order of checks, the allowances, what is
 * recorded and what the prospect reads are the route's own.
 */
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findGrant: vi.fn(),
  countEvents: vi.fn(),
  lastEvent: vi.fn(),
  createEvent: vi.fn(),
  claude: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    demoGrant: { findUnique: mocks.findGrant },
    demoAccessEvent: { count: mocks.countEvents, findFirst: mocks.lastEvent, create: mocks.createEvent },
  },
}))
vi.mock("@/lib/rls-context", () => ({ runWithRlsBypass: (fn: () => unknown) => Promise.resolve().then(fn) }))
vi.mock("@/lib/demo-center/access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/demo-center/access")>()),
  expireDemoGrantIfNeeded: async () => false,
}))
vi.mock("@/lib/demo-center/security", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/demo-center/security")>()),
  secureHashMatches: () => true,
}))
vi.mock("@/lib/ai/anthropic-client", () => ({ getAnthropicClient: () => ({ messages: { create: mocks.claude } }) }))

import { POST } from "@/app/api/v1/public/demo-access/[token]/assistant/route"
import { DEMO_PREPARED_INTENTS } from "@/lib/demo-center/assistant/prepared-answers"
import { DEMO_ASSISTANT_MAX_PREPARED, DEMO_ASSISTANT_MAX_QUESTIONS, DEMO_ASSISTANT_REFUSAL_TEXT } from "@/lib/demo-center/assistant/policy"
import { PROSPECT_TO_CLOSED_WON } from "@/lib/demo-center/journey"

const TOKEN = "a".repeat(64)
const PRICE_ANSWER = DEMO_PREPARED_INTENTS.price.answer()
const DEAL_STEP = PROSPECT_TO_CLOSED_WON.sections.flatMap((section) => section.steps).find((step) => step.id === "deal-advance")!

function ask(question: string, stepId = "deal-advance") {
  return POST(
    new NextRequest(`https://app.leaddrivecrm.org/api/v1/public/demo-access/${TOKEN}/assistant`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `ld_demo_session=x` },
      body: JSON.stringify({ question, state: "DEAL_CREATED", sectionId: "deals", stepId }),
    }),
    { params: Promise.resolve({ token: TOKEN }) },
  )
}

/** What Jev answers, per call. */
function jevAnswers(...answers: Array<{ choice: string; confidence: number } | number>) {
  const fetchMock = vi.fn()
  for (const answer of answers) {
    fetchMock.mockResolvedValueOnce(
      typeof answer === "number"
        ? new Response("{}", { status: answer })
        : new Response(JSON.stringify({ answers: { intent: answer }, usage: { input_tokens: 700 } }), { status: 200 }),
    )
  }
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

function counts({ asked = 0, prepared = 0 }: { asked?: number; prepared?: number } = {}) {
  mocks.countEvents.mockImplementation(async ({ where }: { where: { eventType: string } }) =>
    where.eventType === "ASSISTANT_ASKED" ? asked : prepared)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  process.env.TYPESAFE_API_KEY = "test-key"
  mocks.findGrant.mockResolvedValue({
    id: "grant-1", status: "ACTIVE", sessionHash: "h", linkExpiresAt: new Date(Date.now() + 86_400_000),
    request: { name: "Nigar Əliyeva", company: "Xəzər Logistika MMC", jobTitle: null, email: "nigar@example.az", phone: null, source: "website" },
  })
  counts()
  mocks.lastEvent.mockResolvedValue(null)
  mocks.createEvent.mockResolvedValue({})
  mocks.claude.mockResolvedValue({ content: [{ type: "text", text: "Da Vinci cavabı" }], usage: { input_tokens: 900, output_tokens: 60 } })
})

const recorded = () => mocks.createEvent.mock.calls.map(([arg]) => arg.data.eventType)

describe("a question Jev is sure about", () => {
  it("gets the approved answer at once, without Da Vinci, recorded apart from the Da Vinci allowance", async () => {
    jevAnswers({ choice: "price", confidence: 0.99 })
    const response = await ask("Qiyməti nə qədərdir?")
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, answer: PRICE_ANSWER, source: "prepared", remaining: DEMO_ASSISTANT_MAX_QUESTIONS })
    expect(mocks.claude).not.toHaveBeenCalled()
    expect(recorded()).toEqual(["ASSISTANT_PREPARED"])
    expect(mocks.createEvent.mock.calls[0][0].data.metadata).toMatchObject({ intent: "price", confidence: 0.99, inputTokens: 700 })
  })

  it("is answered even after the Da Vinci questions have run out", async () => {
    counts({ asked: DEMO_ASSISTANT_MAX_QUESTIONS })
    jevAnswers({ choice: "price", confidence: 0.97 })
    const response = await ask("Сколько стоит?")
    expect(response.status).toBe(200)
    expect((await response.json()).answer).toBe(PRICE_ANSWER)
  })

  it("«where do I click» is answered from the step the server knows, not from anything the browser sent", async () => {
    jevAnswers({ choice: "screen_help", confidence: 0.95 })
    const body = await (await ask("İndi hara basım?")).json()
    expect(body.answer).toContain(DEAL_STEP.title)
    expect(body.answer).toContain(DEAL_STEP.instruction)
  })
})

describe("everything else goes to Da Vinci, exactly as before", () => {
  it.each([
    ["an answer below the confidence bar", [{ choice: "price", confidence: 0.8 }]],
    ["a question none of the prepared answers fits", [{ choice: "other", confidence: 0.99 }]],
    ["an answer naming no option we have", [{ choice: "discounts", confidence: 0.99 }]],
    ["Jev overloaded twice", [529, 529]],
    ["Jev rejecting the request", [500]],
  ] as const)("%s", async (_label, answers) => {
    jevAnswers(...answers)
    const response = await ask("Bu ehtimal niyə 45%-dir?")
    expect(await response.json()).toMatchObject({ success: true, answer: "Da Vinci cavabı" })
    expect(mocks.claude).toHaveBeenCalledTimes(1)
    expect(recorded()).toEqual(["ASSISTANT_ASKED"])
  })

  it("and without a key Jev is not asked at all", async () => {
    delete process.env.TYPESAFE_API_KEY
    const fetchMock = jevAnswers({ choice: "price", confidence: 0.99 })
    await ask("Qiyməti?")
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.claude).toHaveBeenCalledTimes(1)
  })

  it("and a session past its prepared cap is not sent to Jev — its rate limit is shared with social monitoring", async () => {
    counts({ prepared: DEMO_ASSISTANT_MAX_PREPARED })
    const fetchMock = jevAnswers({ choice: "price", confidence: 0.99 })
    await ask("Qiyməti?")
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.claude).toHaveBeenCalledTimes(1)
  })

  it("a Da Vinci question past its allowance is still refused", async () => {
    counts({ asked: DEMO_ASSISTANT_MAX_QUESTIONS })
    jevAnswers({ choice: "other", confidence: 0.99 })
    const response = await ask("Bu ehtimal niyə 45%-dir?")
    expect(response.status).toBe(429)
    expect((await response.json()).error).toBe(DEMO_ASSISTANT_REFUSAL_TEXT.quota_exhausted)
    expect(mocks.claude).not.toHaveBeenCalled()
  })
})

describe("the pace applies to every question", () => {
  it("refuses a question right after a prepared one, before asking anyone", async () => {
    mocks.lastEvent.mockResolvedValue({ occurredAt: new Date(Date.now() - 1_000) })
    const fetchMock = jevAnswers({ choice: "price", confidence: 0.99 })
    const response = await ask("Qiyməti?")
    expect(response.status).toBe(429)
    expect((await response.json()).error).toBe(DEMO_ASSISTANT_REFUSAL_TEXT.too_fast)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.claude).not.toHaveBeenCalled()
    // …and the pace is read across both kinds of answer.
    expect(mocks.lastEvent.mock.calls[0][0].where.eventType).toEqual({ in: ["ASSISTANT_ASKED", "ASSISTANT_PREPARED"] })
  })
})

describe("what Jev is shown", () => {
  it("masks contact details a prospect types into a question", async () => {
    const fetchMock = jevAnswers({ choice: "other", confidence: 0.99 })
    await ask("Mənə +994 50 123 45 67 nömrəsinə zəng edin, email nigar@example.az")
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(sent.state.prospect_question).not.toContain("123 45 67")
    expect(sent.state.prospect_question).not.toContain("nigar@example.az")
    expect(Object.keys(sent.questions.intent.criteria)).toEqual(Object.keys(DEMO_PREPARED_INTENTS))
  })
})
