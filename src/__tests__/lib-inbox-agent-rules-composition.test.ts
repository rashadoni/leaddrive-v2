import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { composeInboxAgentRules, languageRuleFor } from "@/lib/inbox/agent-instruction"

/**
 * A custom agent prompt replaces the built-in rules wholesale. That is right for
 * personality and wrong for everything else in that list, and the difference was
 * never enforced anywhere.
 *
 * On 2026-08-12 an assistant configured entirely in Azerbaijani answered a
 * customer in English. Its own prompt does say to answer in Azerbaijani; what it
 * no longer had was the built-in language rule, while everything the engine
 * appends around it — lead collection, escalation, the context separator — is
 * written in Russian. The customer's message was a phone number and nothing
 * else, so there was no language in it to follow either.
 */

const BUILT_IN = "BUILT-IN RULES"
const LANGUAGE = "\n\nЯЗЫК ОТВЕТА: ..."
const ESCALATION = "\n\nЭСКАЛАЦИЯ: ..."

describe("inbox agent rules composition", () => {
  it("uses the built-in rules when the organisation has none of its own", () => {
    const rules = composeInboxAgentRules({ builtIn: BUILT_IN, languageRule: LANGUAGE, escalationRule: ESCALATION })
    expect(rules).toBe(BUILT_IN)
    // The built-in list already states both; repeating an instruction weakens
    // every other line around it.
    expect(rules).not.toContain(LANGUAGE.trim())
    expect(rules).not.toContain(ESCALATION.trim())
  })

  it("keeps the language rule when a custom prompt replaces the built-in ones", () => {
    const custom = "Sən Qobustan şirkətinin rəsmi onlayn məsləhətçisisən."
    const rules = composeInboxAgentRules({
      systemPrompt: custom, builtIn: BUILT_IN, languageRule: LANGUAGE, escalationRule: ESCALATION,
    })
    expect(rules).toContain(custom)
    expect(rules).toContain(LANGUAGE.trim())
    expect(rules).toContain(ESCALATION.trim())
    expect(rules).not.toContain(BUILT_IN)
  })

  it("treats a blank custom prompt as none at all", () => {
    for (const blank of ["", "   ", "\n", undefined, null, 42]) {
      expect(composeInboxAgentRules({ systemPrompt: blank, builtIn: BUILT_IN, languageRule: LANGUAGE })).toBe(BUILT_IN)
    }
  })

  it("omits escalation when the organisation turned it off, and still keeps language", () => {
    const rules = composeInboxAgentRules({
      systemPrompt: "custom", builtIn: BUILT_IN, languageRule: LANGUAGE, escalationRule: "",
    })
    expect(rules).toContain(LANGUAGE.trim())
    expect(rules).not.toContain("ЭСКАЛАЦИЯ")
  })
})

describe("the rule the engine actually appends", () => {
  const source = readFileSync("src/lib/social/ai-autoreply.ts", "utf8")

  it("is wired into the reply path, and asks for THIS agent's language", () => {
    // A composer nothing calls would pass every test above and change nothing.
    expect(source).toContain("composeInboxAgentRules({")
    expect(source).toContain("languageRule: languageRuleFor(agent?.replyLanguage)")
  })

  it("follows the customer when no language is chosen", () => {
    const rule = languageRuleFor(null)
    // A message with no words carries no language to mirror.
    expect(rule).toMatch(/только цифры|нет слов/)
    // And the instructions themselves are Russian, which is the pull that has
    // to be named explicitly rather than hoped away.
    expect(rule).toMatch(/инструкци/i)
    expect(rule).toContain("АЗЕРБАЙДЖАНСКОМ")
  })

  it("answers only in the chosen language when one is set", () => {
    const rule = languageRuleFor("az")
    expect(rule).toContain("ТОЛЬКО")
    expect(rule).toContain("Azərbaycan dili")
    // The mirroring clause must be gone, or the two instructions contradict.
    expect(rule).not.toMatch(/Если клиент пишет на русском — отвечай на русском/)
  })

  it("ignores a language it does not know rather than inventing one", () => {
    for (const bad of ["tr", "", null, undefined, 42]) {
      expect(languageRuleFor(bad)).toBe(languageRuleFor(null))
    }
  })
})
