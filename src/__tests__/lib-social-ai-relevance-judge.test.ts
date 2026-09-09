import { beforeEach, describe, expect, it, vi } from "vitest"

const deps = vi.hoisted(() => ({ create: vi.fn(), getAnthropicClient: vi.fn() }))

vi.mock("@/lib/ai/anthropic-client", () => ({
  getAnthropicClient: deps.getAnthropicClient,
}))
vi.mock("@/lib/ai/pii-masker", () => ({
  PiiMasker: class {
    mask(value: string) { return value.replace(/\+\d{6,}/g, "[phone]") }
  },
}))

import {
  AI_RELEVANCE_JUDGE_VERSION,
  buildRelevanceJudgePrompt,
  judgeSubjectRelevance,
  parseJudgeVerdict,
} from "@/lib/social/ai-relevance-judge"

const input = {
  text: "заказ так и не привезли, третий день жду",
  platform: "instagram",
  authorName: "Aysel",
  parentText: "Araz Supermarket — новые цены на этой неделе",
  subjectName: "Araz Supermarket",
  aliases: ["arazsupermarket", "Araz Market"],
  requiredContext: ["market", "supermarket"],
  negativeTerms: ["araz river"],
}

function reply(text: string) {
  return { content: [{ type: "text", text }] }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ANTHROPIC_API_KEY = "test-key"
  deps.getAnthropicClient.mockReturnValue({ messages: { create: deps.create } })
})

describe("ai relevance judge", () => {
  it("returns the three supported verdicts verbatim", async () => {
    for (const verdict of ["about_subject", "not_about_subject", "unsure"] as const) {
      deps.create.mockResolvedValueOnce(reply(verdict))
      await expect(judgeSubjectRelevance(input)).resolves.toEqual({
        verdict,
        errorClass: null,
        version: AI_RELEVANCE_JUDGE_VERSION,
      })
    }
  })

  it("treats anything else as an invalid response instead of guessing", async () => {
    deps.create.mockResolvedValueOnce(reply("probably about the brand"))
    await expect(judgeSubjectRelevance(input)).resolves.toMatchObject({
      verdict: null,
      errorClass: "INVALID_RESPONSE",
    })
  })

  it("fails closed without an API key and without a text", async () => {
    delete process.env.ANTHROPIC_API_KEY
    await expect(judgeSubjectRelevance(input)).resolves.toMatchObject({ errorClass: "MISSING_KEY" })
    process.env.ANTHROPIC_API_KEY = "test-key"
    await expect(judgeSubjectRelevance({ ...input, text: "   " })).resolves.toMatchObject({
      errorClass: "INVALID_INPUT",
    })
    expect(deps.create).not.toHaveBeenCalled()
  })

  it("classifies provider failures so a worker can retry deliberately", async () => {
    deps.create.mockRejectedValueOnce(Object.assign(new Error("rate"), { status: 429 }))
    await expect(judgeSubjectRelevance(input, { logErrors: false })).resolves.toMatchObject({
      errorClass: "RATE_LIMIT",
    })
    deps.create.mockRejectedValueOnce(Object.assign(new Error("auth"), { status: 401 }))
    await expect(judgeSubjectRelevance(input, { logErrors: false })).resolves.toMatchObject({
      errorClass: "AUTHENTICATION",
    })
    deps.create.mockRejectedValueOnce(Object.assign(new Error("upstream"), { status: 503 }))
    await expect(judgeSubjectRelevance(input, { logErrors: false })).resolves.toMatchObject({
      errorClass: "UPSTREAM",
    })
  })

  // Ретраи держит воркер: клиент создаётся без них, иначе истёкший запрос
  // продолжал бы занимать слот провайдера после конца лизы крона.
  it("disables SDK retries and bounds the request", async () => {
    deps.create.mockResolvedValueOnce(reply("unsure"))
    await judgeSubjectRelevance(input, { timeoutMs: 5_000 })
    expect(deps.getAnthropicClient).toHaveBeenCalledWith(
      expect.objectContaining({ maxRetries: 0, timeout: 5_000 }),
    )
    const call = deps.create.mock.calls[0]?.[0]
    // 16, а не 8: на проде вердикт не доезжал в восьми токенах.
    expect(call).toMatchObject({ max_tokens: 16 })
    expect(call.messages[0].content).toContain("Platform: instagram")
    expect(call.messages[0].content).toContain("Parent publication:")
  })

  it("masks personal data before sending the record", async () => {
    deps.create.mockResolvedValueOnce(reply("unsure"))
    await judgeSubjectRelevance({ ...input, text: "звоните мне +994501234567" })
    const sent = deps.create.mock.calls[0]?.[0]?.messages?.[0]?.content as string
    expect(sent).toContain("[phone]")
    expect(sent).not.toContain("994501234567")
  })

  // Судья обязан уметь сказать «не про нас» так же уверенно, как «про нас»,
  // иначе он превращается в машину, всё одобряющую.
  it("states both directions and prefers unsure over guessing in the prompt", () => {
    const prompt = buildRelevanceJudgePrompt(input)
    expect(prompt).toContain("Araz Supermarket")
    expect(prompt).toContain("arazsupermarket")
    expect(prompt).toContain("about_subject")
    expect(prompt).toContain("not_about_subject")
    expect(prompt).toContain("Prefer unsure over guessing")
    // Смысл, а не совпадение строк: это и есть причина существования судьи.
    expect(prompt).toContain("Judge by meaning, not by string overlap")
  })

  it("bounds alias and context lists so one source cannot blow up the prompt", () => {
    const prompt = buildRelevanceJudgePrompt({
      ...input,
      aliases: Array.from({ length: 60 }, (_, index) => `alias-${index}`),
    })
    expect(prompt).toContain("alias-19")
    expect(prompt).not.toContain("alias-20")
  })

  /**
   * Замер на проде 2026-08-03 (80 записей с известным ответом) провалился не на
   * качестве суждения, а на формате: Haiku начинала с «The record is too short…»,
   * обрезка по max_tokens оставляла преамбулу, и строгое равенство отвечало
   * INVALID_RESPONSE почти всегда. Согласие с разметкой вышло 3% и 8% — то есть
   * судья был бы бесполезен, а по логам выглядел бы просто «неуверенным».
   */
  it("starts the answer for the model so it cannot open with a preamble", async () => {
    deps.create.mockResolvedValueOnce(reply("about_subject"))
    await judgeSubjectRelevance(input)

    const [request] = deps.create.mock.calls[0]
    expect(request.messages.at(-1)).toEqual({ role: "assistant", content: "verdict:" })
    // Без пробела на конце: иначе провайдер отвергает начатый ответ.
    expect(request.messages.at(-1).content).not.toMatch(/\s$/)
    expect(request.max_tokens).toBeGreaterThanOrEqual(12)
  })

  it("forbids explanation in the prompt", () => {
    const prompt = buildRelevanceJudgePrompt(input)
    expect(prompt).toMatch(/Do not explain/i)
  })

  it.each([
    ["чистое слово", "about_subject", "about_subject"],
    ["с точкой", "not_about_subject.", "not_about_subject"],
    ["в кавычках", "\"unsure\"", "unsure"],
    ["в верхнем регистре", "ABOUT_SUBJECT", "about_subject"],
    ["с остатком вступления", "the record is vague, so unsure", "unsure"],
    ["внутри фразы", "verdict: not_about_subject — different company", "not_about_subject"],
    // «not_about_subject» содержит «about_subject» подстрокой: порядок проверок
    // не должен решать за модель.
    ["вложенная подстрока", "not_about_subject", "not_about_subject"],
    ["первый вердикт побеждает", "unsure, maybe about_subject", "unsure"],
  ])("extracts the verdict %s", (_label, answer, expected) => {
    expect(parseJudgeVerdict(answer)).toBe(expected)
  })

  it.each([
    ["без вердикта", "probably about the brand"],
    ["пустой ответ", ""],
    ["мусор", "…"],
  ])("returns null for an answer with no verdict: %s", (_label, answer) => {
    expect(parseJudgeVerdict(answer)).toBeNull()
  })
})
