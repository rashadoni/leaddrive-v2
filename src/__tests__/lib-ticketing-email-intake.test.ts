import { describe, expect, it } from "vitest"

import {
  emailIntakeRoutesFromSettings,
  emailIntakeSettingsError,
  extractEmailAddresses,
  matchEmailIntakeRoute,
} from "@/lib/ticketing/email-intake"

describe("ticketing email intake helpers", () => {
  it("extracts normalized addresses from recipient headers", () => {
    expect(extractEmailAddresses('"Support" <Support@Example.COM>, complaints@example.com')).toEqual([
      "support@example.com",
      "complaints@example.com",
    ])
  })

  it("parses ticket and complaint intake routes from channel settings", () => {
    const routes = emailIntakeRoutesFromSettings({
      emailIntake: {
        routes: [
          { address: "support@example.com", target: "ticket", category: "technical" },
          { address: "complaints@example.com", target: "complaint", complaintType: "complaint" },
        ],
      },
    })

    expect(routes).toEqual([
      {
        address: "support@example.com",
        target: "ticket",
        categoryId: null,
        category: "technical",
        priority: null,
        complaintType: "complaint",
        source: null,
      },
      {
        address: "complaints@example.com",
        target: "complaint",
        categoryId: null,
        category: null,
        priority: null,
        complaintType: "complaint",
        source: null,
      },
    ])
  })

  it("rejects duplicated intake addresses inside one email channel", () => {
    expect(emailIntakeSettingsError("email", {
      emailIntake: {
        routes: [
          { address: "support@example.com", target: "ticket" },
          { address: "support@example.com", target: "complaint" },
        ],
      },
    })).toContain("configured more than once")
  })

  it("matches an inbound recipient to the configured tenant route", () => {
    const match = matchEmailIntakeRoute("LeadDrive Support <support@example.com>", [
      {
        id: "ch1",
        organizationId: "org1",
        configName: "Support Email",
        settings: {
          emailIntake: {
            routes: [{ address: "support@example.com", target: "ticket" }],
          },
        },
      },
    ])

    expect(match).toMatchObject({
      ok: true,
      matchedAddress: "support@example.com",
      route: { target: "ticket" },
      channel: { organizationId: "org1" },
    })
  })
})
