import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * What a WhatsApp number's page agent says is decided and tested in `whatsAppPageTurn`
 * (inbox-page-agent.test.ts). This only keeps the webhook attached to it: the reply must stop when
 * the number's schedule says so, and the page's words must be what is appended — if either line
 * is lost, the «ИИ-агент» screen saves a setting for WhatsApp that nothing reads.
 */
const source = readFileSync(resolve("src/app/api/v1/webhooks/whatsapp/route.ts"), "utf8")

describe("the WhatsApp webhook uses the number's page agent", () => {
  it("asks for the number's turn with the channel it arrived on", () => {
    expect(source).toMatch(/whatsAppPageTurn\(\{[^}]*channelConfigId: opts\.channelConfigId[^}]*channelSettings: opts\.channelSettings/s)
  })

  it("stops before the model when the schedule gives the turn to a person", () => {
    const stop = source.indexOf("if (!pageTurn.allowed)")
    const model = source.indexOf('anthropicFor(organizationId, "whatsapp-reply"')
    expect(stop).toBeGreaterThan(0)
    expect(stop).toBeLessThan(model)
  })

  it("appends the page's words, and no longer the support prompt on its own", () => {
    expect(source).toContain("systemPrompt += pageTurn.instructions")
    expect(source).not.toMatch(/systemPrompt \+= "\\n\\nДОПОЛНИТЕЛЬНЫЕ ИНСТРУКЦИИ:\\n" \+ agentConfig\.systemPrompt/)
  })
})
