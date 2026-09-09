import { describe, expect, it } from "vitest"

import {
  INBOX_KNOWLEDGE_HEADING,
  composeInboxAgentInstruction,
} from "@/lib/inbox/agent-instruction"

describe("inbox agent instruction", () => {
  it("keeps rules and approved facts as separate, labelled sections", () => {
    const composed = composeInboxAgentInstruction({
      prompt: "Yalnız Azərbaycan dilində danış.",
      knowledge: "Blokun ölçüsü 60x25 santimetrdir.",
    })
    // An administrator auditing a reply has to be able to tell which field
    // supplied which sentence, so the heading is part of the contract.
    expect(composed).toBe(
      "Yalnız Azərbaycan dilində danış."
      + `\n\n${INBOX_KNOWLEDGE_HEADING}\n`
      + "Blokun ölçüsü 60x25 santimetrdir.",
    )
  })

  it("changes nothing for an agent that has no knowledge yet", () => {
    // Every existing tenant is in this state on the day the column ships. If
    // this added a heading or trailing whitespace, every live agent's prompt
    // would shift underneath it without anyone asking for that.
    expect(composeInboxAgentInstruction({ prompt: "Qaydalar." })).toBe("Qaydalar.")
    expect(composeInboxAgentInstruction({ prompt: "Qaydalar.", knowledge: "   " }))
      .toBe("Qaydalar.")
    expect(composeInboxAgentInstruction({ prompt: "Qaydalar.", knowledge: null }))
      .toBe("Qaydalar.")
  })

  it("still labels the facts when only knowledge is filled in", () => {
    const composed = composeInboxAgentInstruction({ knowledge: "Qiymət siyahısı." })
    expect(composed).toBe(`${INBOX_KNOWLEDGE_HEADING}\nQiymət siyahısı.`)
  })
})
