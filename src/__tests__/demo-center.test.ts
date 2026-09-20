import { describe, expect, it } from "vitest"
import {
  DEMO_MODULE_CATALOG,
  DEMO_MODULE_IDS,
  getDemoModules,
} from "@/lib/demo-center/catalog"
import {
  emailDomain,
  demoSessionCookieName,
  demoVerificationCookieName,
  generateDemoOtp,
  isCorporateEmail,
  issueBrowserCredential,
  maskEmail,
  maskPhone,
  secureHashMatches,
} from "@/lib/demo-center/security"
import {
  isSessionExpired,
  publicAccessState,
  shouldExpireGrant,
} from "@/lib/demo-center/session"
import {
  demoGrantIssueSchema,
  demoRequestSchema,
} from "@/lib/demo-center/validation"
import { scrubDemoTokens } from "@/lib/demo-center/telemetry"

const NOW = new Date("2026-09-19T12:00:00.000Z")

function grantTimeState(overrides: Partial<{
  status: string
  linkExpiresAt: Date
  verificationExpiresAt: Date | null
  sessionStartedAt: Date | null
  sessionLastSeenAt: Date | null
  sessionExpiresAt: Date | null
  inactivityMinutes: number
}> = {}) {
  return {
    status: "SENT",
    linkExpiresAt: new Date("2026-09-26T12:00:00.000Z"),
    verificationExpiresAt: null,
    sessionStartedAt: null,
    sessionLastSeenAt: null,
    sessionExpiresAt: null,
    inactivityMinutes: 30,
    ...overrides,
  }
}

describe("Demo Center catalog", () => {
  it("exposes exactly the approved 19 modules and no Social module", () => {
    expect(DEMO_MODULE_IDS).toHaveLength(19)
    expect(new Set(DEMO_MODULE_IDS).size).toBe(19)
    expect(DEMO_MODULE_IDS).not.toContain("social")
    expect(DEMO_MODULE_CATALOG.map((module) => module.id)).toEqual(DEMO_MODULE_IDS)
    expect(DEMO_MODULE_CATALOG.every((module) => module.steps.length === 3)).toBe(true)
  })

  it("returns only known modules, preserving admin order and removing duplicates", () => {
    expect(getDemoModules(["sales", "unknown", "crm", "sales"]).map((module) => module.id))
      .toEqual(["sales", "crm"])
  })
})

describe("Demo Center request and credential security", () => {
  it("requires consent and a corporate email", () => {
    expect(demoRequestSchema.safeParse({
      name: "Rəşad",
      company: "LeadDrive",
      email: "rashad@gmail.com",
      consent: true,
    }).success).toBe(false)

    expect(demoRequestSchema.safeParse({
      name: "Rəşad",
      company: "LeadDrive",
      email: "RASHAD@EXAMPLE.AZ ",
      consent: true,
    }).success).toBe(true)

    expect(demoRequestSchema.safeParse({
      name: "Rəşad",
      company: "LeadDrive",
      email: "rashad@example.az",
    }).success).toBe(false)
  })

  it("rejects unapproved grant modules", () => {
    expect(demoGrantIssueSchema.safeParse({ moduleIds: ["crm", "social"] }).success).toBe(false)
    expect(demoGrantIssueSchema.safeParse({ moduleIds: ["crm", "sales"] }).success).toBe(true)
  })

  it("recognizes and masks corporate addresses without exposing the full local part", () => {
    expect(isCorporateEmail("buyer@enterprise.az")).toBe(true)
    expect(isCorporateEmail("buyer@outlook.com")).toBe(false)
    expect(emailDomain(" Buyer@Enterprise.AZ ")).toBe("enterprise.az")
    expect(maskEmail("buyer@enterprise.az")).toBe("bu•••@enterprise.az")
  })

  it("masks a phone down to prefix and last two digits, and refuses fragments", () => {
    const masked = maskPhone("+994 50 123 45 67")
    expect(masked).not.toBeNull()
    expect(masked).toContain("+994")
    expect(masked!.endsWith("67")).toBe(true)
    // Nothing between the prefix and the tail survives.
    expect(masked).not.toContain("50")
    expect(masked).not.toContain("123")
    expect(masked).not.toContain("45")
    expect(maskPhone("0123")).toBeNull()
    expect(maskPhone("   ")).toBeNull()
  })

  it("uses six-digit OTPs and constant-time-verifiable browser credentials", () => {
    expect(generateDemoOtp()).toMatch(/^\d{6}$/u)
    const credential = issueBrowserCredential()
    expect(secureHashMatches(credential.credential, credential.credentialHash)).toBe(true)
    expect(secureHashMatches(`${credential.credential}0`, credential.credentialHash)).toBe(false)
  })

  it("scopes cookies per invitation so two demos do not overwrite each other", () => {
    const first = "a".repeat(64)
    const second = "b".repeat(64)
    expect(demoSessionCookieName(first)).not.toBe(demoSessionCookieName(second))
    expect(demoVerificationCookieName(first)).not.toBe(demoVerificationCookieName(second))
    expect(demoSessionCookieName(first)).not.toContain(first)
  })
})

describe("Demo Center one-session lifecycle", () => {
  it("does not consume access when the invitation link is merely opened", () => {
    const grant = grantTimeState({ status: "SENT" })
    expect(publicAccessState(grant, { verified: false, session: false }, NOW)).toBe("ready_for_otp")
  })

  it("recognizes only the bound browser credential as the active session", () => {
    const active = grantTimeState({
      status: "ACTIVE",
      sessionStartedAt: new Date("2026-09-19T11:00:00.000Z"),
      sessionLastSeenAt: new Date("2026-09-19T11:50:00.000Z"),
      sessionExpiresAt: new Date("2026-09-19T13:00:00.000Z"),
    })
    expect(publicAccessState(active, { verified: false, session: true }, NOW)).toBe("active")
    expect(publicAccessState(active, { verified: false, session: false }, NOW)).toBe("active_elsewhere")
  })

  it("expires at the idle deadline even before the absolute deadline", () => {
    const idle = grantTimeState({
      status: "ACTIVE",
      sessionStartedAt: new Date("2026-09-19T10:00:00.000Z"),
      sessionLastSeenAt: new Date("2026-09-19T11:29:59.999Z"),
      sessionExpiresAt: new Date("2026-09-19T13:00:00.000Z"),
    })
    expect(isSessionExpired(idle, NOW)).toBe(true)
    expect(shouldExpireGrant(idle, NOW)).toBe(true)
  })

  it("allows refresh and reconnect inside both session deadlines", () => {
    const active = grantTimeState({
      status: "ACTIVE",
      sessionStartedAt: new Date("2026-09-19T10:30:00.000Z"),
      sessionLastSeenAt: new Date("2026-09-19T11:45:00.000Z"),
      sessionExpiresAt: new Date("2026-09-19T12:30:00.000Z"),
    })
    expect(isSessionExpired(active, NOW)).toBe(false)
    expect(publicAccessState(active, { verified: false, session: true }, NOW)).toBe("active")
  })
})

describe("Demo Center telemetry hygiene", () => {
  it("recursively removes bearer tokens from captured URLs and breadcrumbs", () => {
    const token = "c".repeat(64)
    const event = scrubDemoTokens({
      request: { url: `https://app.example/demo-access/${token}` },
      breadcrumbs: [{ message: `POST /api/v1/public/demo-access/${token}/events` }],
    })

    expect(event.request.url).toBe("https://app.example/demo-access/[redacted]")
    expect(event.breadcrumbs[0]?.message).toBe("POST /api/v1/public/demo-access/[redacted]/events")
  })
})

describe("Demo Center grant shape: scenario or modules", () => {
  it("issues a guided scenario without a module list", () => {
    const parsed = demoGrantIssueSchema.safeParse({ scenarioId: "prospect-to-closed-won" })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.moduleIds).toEqual([])
  })

  it("refuses both at once — the player would have to guess which was granted", () => {
    expect(demoGrantIssueSchema.safeParse({
      scenarioId: "prospect-to-closed-won",
      moduleIds: ["crm"],
    }).success).toBe(false)
  })

  it("refuses neither — that link would open nothing", () => {
    expect(demoGrantIssueSchema.safeParse({}).success).toBe(false)
    expect(demoGrantIssueSchema.safeParse({ moduleIds: [] }).success).toBe(false)
  })

  it("refuses a scenario the server does not approve", () => {
    for (const scenarioId of ["salesforce-clone", "__proto__", "constructor", "prospect-to-closed-won-x"]) {
      expect(demoGrantIssueSchema.safeParse({ scenarioId }).success, scenarioId).toBe(false)
    }
  })
})
