import { describe, expect, it } from "vitest"

import { buildUnresolvedOutboundCallWhere } from "@/lib/voice-agent/unresolved-call"

describe("unresolved outbound voice-call fence", () => {
  it("uses exact canonical phone identity and retains provider-unknown rows", () => {
    expect(buildUnresolvedOutboundCallWhere({
      organizationId: "org-1",
      targetPhoneE164: "+994500000001",
      callModes: ["human"],
    })).toEqual({
      organizationId: "org-1",
      direction: "outbound",
      targetPhoneE164: "+994500000001",
      callMode: { in: ["human"] },
      providerOutcome: null,
      OR: [
        { endedAt: null },
        { conversationOutcome: "provider_unknown_no_redial" },
      ],
    })
  })
})
