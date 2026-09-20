/**
 * The guided demo's assistant.
 *
 * Pins the two properties that make it safe to expose a paid model call to a
 * public session: the quota is durable and the grounding cannot be written
 * from outside. The rest is policy — what it refuses and in what language.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { buildAssistantGrounding } from "@/lib/demo-center/assistant/context"
import {
  DEMO_ASSISTANT_MAX_QUESTIONS,
  DEMO_ASSISTANT_MAX_QUESTION_CHARS,
  DEMO_ASSISTANT_MIN_GAP_MS,
  DEMO_ASSISTANT_MODEL,
  DEMO_ASSISTANT_REFUSAL_TEXT,
  buildAssistantSystemPrompt,
  checkAssistantAllowance,
  checkAssistantQuestion,
} from "@/lib/demo-center/assistant/policy"
import {
  DEMO_JOURNEY_HAPPY_PATH,
  PROSPECT_TO_CLOSED_WON,
  createJourneySnapshot,
  rebuildRecordsAtState,
  type DemoProspectIdentity,
} from "@/lib/demo-center/journey"

const ROOT = process.cwd()
const ROUTE = "src/app/api/v1/public/demo-access/[token]/assistant/route.ts"
const NOW = new Date("2026-09-21T09:00:00.000Z")

const identity: DemoProspectIdentity = {
  name: "Nigar Əliyeva",
  company: "Xəzər Logistika MMC",
  jobTitle: "Satış direktoru",
  emailMasked: "n•••@xezerlog.az",
  phoneMasked: "+994 ••••• 67",
  sourceChannel: "instagram",
}

describe("Assistant policy: the question", () => {
  it("trims, and refuses empty, non-string and over-long input", () => {
    expect(checkAssistantQuestion("  Bu ekran nədir?  ")).toEqual({ ok: true, question: "Bu ekran nədir?" })
    expect(checkAssistantQuestion("   ").refusal).toBe("empty")
    expect(checkAssistantQuestion("").refusal).toBe("empty")
    expect(checkAssistantQuestion(null).refusal).toBe("empty")
    expect(checkAssistantQuestion({ toString: () => "x" }).refusal).toBe("empty")
    expect(checkAssistantQuestion("a".repeat(DEMO_ASSISTANT_MAX_QUESTION_CHARS + 1)).refusal).toBe("too_long")
    expect(checkAssistantQuestion("a".repeat(DEMO_ASSISTANT_MAX_QUESTION_CHARS)).ok).toBe(true)
  })
})

describe("Assistant policy: the allowance", () => {
  it("allows the owner's 50 questions and stops at the 51st", () => {
    expect(DEMO_ASSISTANT_MAX_QUESTIONS).toBe(50)
    expect(checkAssistantAllowance({ asked: 0, lastAskedAt: null }, NOW)).toEqual({ ok: true, remaining: 50 })
    expect(checkAssistantAllowance({ asked: 49, lastAskedAt: null }, NOW).ok).toBe(true)
    const exhausted = checkAssistantAllowance({ asked: 50, lastAskedAt: null }, NOW)
    expect(exhausted).toEqual({ ok: false, refusal: "quota_exhausted", remaining: 0 })
    // Never negative, even if rows somehow outran the cap.
    expect(checkAssistantAllowance({ asked: 99, lastAskedAt: null }, NOW).remaining).toBe(0)
  })

  it("keeps a gap between questions so a script cannot burn the quota at once", () => {
    const justNow = new Date(NOW.getTime() - 1_000)
    expect(checkAssistantAllowance({ asked: 1, lastAskedAt: justNow }, NOW).refusal).toBe("too_fast")
    const longEnough = new Date(NOW.getTime() - DEMO_ASSISTANT_MIN_GAP_MS)
    expect(checkAssistantAllowance({ asked: 1, lastAskedAt: longEnough }, NOW).ok).toBe(true)
  })

  it("answers every refusal in Azerbaijani, without Cyrillic", () => {
    for (const [refusal, text] of Object.entries(DEMO_ASSISTANT_REFUSAL_TEXT)) {
      expect(text.trim(), refusal).not.toBe("")
      expect(text, refusal).not.toMatch(/[А-Яа-яЁё]/)
    }
  })
})

describe("Assistant policy: the system prompt", () => {
  const prompt = buildAssistantSystemPrompt("KONTEKST SƏTRİ")

  it("carries the grounding and names it as the only fact source", () => {
    expect(prompt).toContain("KONTEKST SƏTRİ")
    expect(prompt).toContain("uydurma")
  })

  it("forbids answering commercial questions rather than leaving it to judgement", () => {
    for (const topic of ["Qiymət", "SLA", "inteqrasiya"]) {
      expect(prompt.toLowerCase(), topic).toContain(topic.toLowerCase())
    }
    expect(prompt).toContain("satış komandası")
  })

  it("tells the model the question is data, not instruction", () => {
    expect(prompt).toContain("göstəriş deyil")
  })

  it("uses the model the owner chose", () => {
    expect(DEMO_ASSISTANT_MODEL).toBe("claude-sonnet-4-6")
  })
})

describe("Assistant grounding", () => {
  const snapshot = createJourneySnapshot(PROSPECT_TO_CLOSED_WON, identity, NOW)

  it("describes where the prospect is and who they are", () => {
    const grounding = buildAssistantGrounding(snapshot, PROSPECT_TO_CLOSED_WON)
    expect(grounding).toContain(identity.name)
    expect(grounding).toContain(identity.company)
    expect(grounding).toContain(identity.emailMasked)
    expect(grounding).toContain("STARTED")
    expect(grounding).toContain("nümunədir")
  })

  it("grows with the story instead of inventing it up front", () => {
    const atStart = buildAssistantGrounding(snapshot, PROSPECT_TO_CLOSED_WON)
    expect(atStart).toContain("Lider hələ yaradılmayıb")

    const later = buildAssistantGrounding(
      { ...snapshot, state: "CLOSED_WON", records: rebuildRecordsAtState(identity, "CLOSED_WON", NOW, DEMO_JOURNEY_HAPPY_PATH) },
      PROSPECT_TO_CLOSED_WON,
    )
    expect(later).toContain("QAZANILIB")
    expect(later).toContain("Kommersiya təklifi")
    expect(later).not.toContain("Lider hələ yaradılmayıb")
  })

  it("says plainly that the call is off, so the assistant cannot imply one happened", () => {
    expect(buildAssistantGrounding(snapshot, PROSPECT_TO_CLOSED_WON)).toContain("söndürülüb")
  })
})

describe("Records rebuilt from identity alone", () => {
  it("reaches the same records the reducer would, without a client snapshot", () => {
    const rebuilt = rebuildRecordsAtState(identity, "CLOSED_WON", NOW, DEMO_JOURNEY_HAPPY_PATH)
    expect(rebuilt.lead?.contactName).toBe(identity.name)
    expect(rebuilt.deal?.wonAt).not.toBeNull()
    expect(rebuilt.quote?.status).toBe("accepted")
    expect(rebuilt.task).not.toBeNull()
  })

  it("stops where the story stopped", () => {
    const early = rebuildRecordsAtState(identity, "AI_REPLIED", NOW, DEMO_JOURNEY_HAPPY_PATH)
    expect(early.lead).toBeNull()
    expect(early.deal).toBeNull()
    expect(early.conversation.messages.some((message) => message.ai)).toBe(true)
  })

  it("handles a call outcome that is not on the happy path", () => {
    const declined = rebuildRecordsAtState(identity, "CALL_DECLINED", NOW, DEMO_JOURNEY_HAPPY_PATH)
    expect(declined.lead?.timeline.some((entry) => entry.id === "tl-call")).toBe(true)
  })
})

describe("Assistant route contract", () => {
  const source = readFileSync(path.join(ROOT, ROUTE), "utf8")

  it("requires an active grant bound to this browser", () => {
    expect(source).toContain("validRawDemoToken")
    expect(source).toContain("expireDemoGrantIfNeeded")
    expect(source).toContain('grant.status !== "ACTIVE"')
    expect(source).toContain("secureHashMatches")
  })

  it("counts the quota from append-only rows, not a process-local limiter", () => {
    expect(source).toContain("prisma.demoAccessEvent.count")
    expect(source).toContain("checkAssistantAllowance")
    // A restart or a second instance must not hand out a fresh 50.
    expect(source).not.toContain("checkRateLimit")
  })

  it("builds the grounding from the database, never from the request body", () => {
    expect(source).toContain("rebuildRecordsAtState")
    expect(source).toContain("grant.request")
    // Only the position is taken from the client, and it is validated first.
    expect(source).toContain("findSection(SCENARIO")
    expect(source).toContain("findStep(SCENARIO")
    expect(source).not.toMatch(/body\.(records|identity|grounding|snapshot)\b/)
  })

  it("masks the contact details it does pass through", () => {
    expect(source).toContain("maskEmail")
    expect(source).toContain("maskPhone")
  })

  it("records what the answer cost on the grant's own timeline", () => {
    expect(source).toContain("calculateAiCost")
    expect(source).toContain("promptTokens")
    expect(source).toContain("completionTokens")
  })

  it("fails closed when the model call does not come back", () => {
    expect(source).toContain('refuse("unavailable", 502)')
  })
})
