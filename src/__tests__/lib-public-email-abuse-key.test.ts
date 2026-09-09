import { describe, expect, it } from "vitest"
import { publicEmailAbuseKey } from "@/lib/public-email-abuse-key"

describe("publicEmailAbuseKey", () => {
  it("collapses plus-address variants without retaining the attacker tag", () => {
    expect(publicEmailAbuseKey(" Victim+one@Example.COM ")).toBe("victim@example.com")
    expect(publicEmailAbuseKey("victim+two@example.com")).toBe("victim@example.com")
  })

  it("collapses Gmail dot and googlemail aliases", () => {
    expect(publicEmailAbuseKey("first.last+event@googlemail.com")).toBe("firstlast@gmail.com")
    expect(publicEmailAbuseKey("firstlast@gmail.com")).toBe("firstlast@gmail.com")
  })

  it("keeps dots significant outside Gmail", () => {
    expect(publicEmailAbuseKey("first.last@example.com")).toBe("first.last@example.com")
    expect(publicEmailAbuseKey("firstlast@example.com")).toBe("firstlast@example.com")
  })
})
