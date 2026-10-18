/**
 * LeadDrive's own AI agent profile (src/lib/demo-center/journey/
 * leaddrive-agent-profile.ts): the prompt, style and knowledge the demo shows
 * as «the ready setup», and the one its agent answers prospects with on
 * WhatsApp. What a sales agent says is what LeadDrive promises, so the rules
 * the profile was written under are held here.
 */
import { describe, expect, it } from "vitest"
import { LEADDRIVE_AGENT_PROFILE as P } from "@/lib/demo-center/journey/leaddrive-agent-profile"
import { guardOmnichannelCommitments } from "@/lib/inbox/omnichannel-commitment-rules"

const everything = [P.greeting, P.systemPrompt, P.style, P.knowledgeBase, ...P.articles.flatMap((article) => [article.title, article.body]), ...P.sampleReplies.map((reply) => reply.agent)]

describe("LeadDrive's own agent profile", () => {
  it("has the three parts the demo shows: a prompt, a style and a knowledge base", () => {
    expect(P.systemPrompt).toMatch(/^# Rol/m)
    expect(P.systemPrompt).toMatch(/^# Məqsəd/m)
    expect(P.systemPrompt).toMatch(/^# Qaydalar/m)
    expect(P.style).toMatch(/^# Ünsiyyət tərzi/m)
    expect(P.knowledgeBase.length).toBeGreaterThan(500)
    expect(P.knowledgeBase.length).toBeLessThanOrEqual(6_000)
    expect(P.articles.length).toBeGreaterThanOrEqual(10)
    for (const article of P.articles) expect(article.sources.length, article.title).toBeGreaterThan(0)
  })

  it("lets every line the agent says to a prospect through the product's commitment guard unchanged", () => {
    for (const line of [P.greeting, ...P.sampleReplies.map((reply) => reply.agent)]) {
      expect(guardOmnichannelCommitments(line, { locale: "az" }).violations, line).toEqual([])
    }
  })

  it("names no price anywhere, and the lines a prospect hears name no trial and no «ready in a day»", () => {
    // The prompt and the knowledge base may say «AZN» — invoices are issued in
    // it, and the rules forbid quoting an amount in it — but never an amount.
    for (const text of everything) {
      expect(text, text.slice(0, 80)).not.toMatch(/\d[\d\s.,]*\s*(₼|AZN|manat)|(₼|AZN)\s*\d/i)
    }
    // A prospect may hear that there is no trial — never that there is one.
    for (const line of [P.greeting, ...P.sampleReplies.map((reply) => reply.agent)]) {
      for (const clause of line.split(/[.!?,;:]\s*/)) {
        if (!/₼|\bAZN\b|\bmanat\b|pulsuz|sınaq|gündə hazır/i.test(clause)) continue
        expect(clause).toMatch(/(yoxdur|olunmur|edilmir|deyil)$/)
      }
    }
  })

  it("does not claim what does not work today: Instagram Direct waits for Meta, the field app is not in Google Play", () => {
    for (const text of everything) {
      expect(text, text.slice(0, 80)).not.toMatch(/Google Play-?d[əa] (var|mövcuddur|yüklə)/i)
      expect(text, text.slice(0, 80)).not.toMatch(/TikTok.{0,40}(cavab ver|yazışma)/i)
    }
    const instagramSays = everything.filter((text) => /Instagram/i.test(text))
    for (const text of instagramSays) expect(text, text.slice(0, 120)).toMatch(/Meta|yoxlama|təsdiq|asılıdır/i)
  })

  it("speaks to the prospect with «Siz» and as an AI, never as a person", () => {
    expect(P.systemPrompt).toMatch(/AI/)
    expect(P.style).toMatch(/«Siz»/)
  })
})
