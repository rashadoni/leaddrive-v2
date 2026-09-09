import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  evaluateManualLeadAiCallPolicy,
  normalizeManualLeadPhone,
} from "@/lib/voice-agent/manual-lead-call"

const OPEN_NOW = new Date("2026-08-10T06:00:00.000Z") // Monday 10:00 Asia/Baku

function readyAsteriskConfig() {
  return {
    id: "cfg-newest",
    configName: "Asterisk",
    phoneNumber: null,
    apiKey: null,
    isActive: true,
    settings: {
      provider: "asterisk",
      ariHost: "pbx.internal",
      ariPort: 8088,
      username: "ari-user",
      password: "secret",
      context: "outbound-routes",
      callerExtension: "100",
      voiceAgentEnabled: true,
      voiceAgentMode: "outbound",
      manualLeadAiCallsEnabled: true,
    },
  }
}

function openVoiceHours() {
  return {
    id: "hours-voice",
    timezone: "Asia/Baku",
    isActive: true,
    schedule: {
      mon: { enabled: true, intervals: [{ start: "09:00", end: "18:00" }] },
    },
    holidays: [],
  }
}

function policyDb(overrides: Record<string, unknown> = {}) {
  const db = {
    lead: {
      findFirst: vi.fn().mockResolvedValue({
        id: "lead-1",
        assignedTo: "user-1",
        status: "new",
        phone: "994501234567",
      }),
    },
    channelConfig: { findMany: vi.fn().mockResolvedValue([readyAsteriskConfig()]) },
    businessHours: { findFirst: vi.fn().mockResolvedValue(openVoiceHours()) },
    voiceCallSession: {
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
    },
    callLog: { findFirst: vi.fn().mockResolvedValue(null) },
    voiceSuppression: { findMany: vi.fn().mockResolvedValue([]) },
    voiceConsent: { findMany: vi.fn().mockResolvedValue([]) },
    ...overrides,
  }
  return db
}

describe("manual lead AI phone normalization", () => {
  // Every stored spelling must reach the trunk as the same digits-only
  // international form. Preserving the entered shape made the destination
  // depend on data entry: a leading national zero is unroutable on this
  // carrier and failed in about a second, while call_logs still recorded a
  // correct-looking E.164 number.
  it.each([
    ["+994 50 123 45 67", { e164: "+994501234567", dialNumber: "994501234567" }],
    ["994501234567", { e164: "+994501234567", dialNumber: "994501234567" }],
    ["050 123 45 67", { e164: "+994501234567", dialNumber: "994501234567" }],
  ])("dials %s as the digits-only international form", (raw, expected) => {
    expect(normalizeManualLeadPhone(raw)).toEqual(expected)
  })

  it("never lets a national leading zero reach the dial string", () => {
    for (const raw of ["0501234567", "050 123 45 67", "+994501234567", "994501234567"]) {
      const normalized = normalizeManualLeadPhone(raw)
      expect(normalized?.dialNumber).toBe("994501234567")
      expect(normalized?.dialNumber.startsWith("0")).toBe(false)
      expect(normalized?.dialNumber.startsWith("+")).toBe(false)
    }
  })

  it.each([null, "", "501234567", "994123", "+0123456789", "050-abc-4567"])(
    "rejects ambiguous or invalid input %s",
    (raw) => expect(normalizeManualLeadPhone(raw)).toBeNull(),
  )
})

describe("manual lead AI policy", () => {
  beforeEach(() => vi.clearAllMocks())

  it("requires exact assignment for every non-manager role", async () => {
    const db = policyDb()
    await evaluateManualLeadAiCallPolicy({
      db: db as never,
      auth: { orgId: "org-1", userId: "user-1", role: "support" },
      leadId: "lead-1",
      now: OPEN_NOW,
    })
    expect(db.lead.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ assignedTo: "user-1" }),
    }))
  })

  it("lets manager-or-above inspect the tenant lead without an assignee predicate", async () => {
    const db = policyDb()
    await evaluateManualLeadAiCallPolicy({
      db: db as never,
      auth: { orgId: "org-1", userId: "manager-1", role: "manager" },
      leadId: "lead-1",
      now: OPEN_NOW,
    })
    const where = db.lead.findFirst.mock.calls[0][0].where
    expect(where).not.toHaveProperty("assignedTo")
  })

  it("distinguishes an unconfigured voice schedule from a configured closed window", async () => {
    const unconfiguredDb = policyDb({
      businessHours: { findFirst: vi.fn().mockResolvedValue(null) },
    })
    const unconfigured = await evaluateManualLeadAiCallPolicy({
      db: unconfiguredDb as never,
      auth: { orgId: "org-1", userId: "user-1", role: "sales" },
      leadId: "lead-1",
      now: OPEN_NOW,
    })
    expect(unconfigured.preflight.blockers).toContain("voice_calling_hours_unconfigured")
    expect(unconfigured.preflight.blockers).not.toContain("outside_calling_hours")

    const closedDb = policyDb()
    const closed = await evaluateManualLeadAiCallPolicy({
      db: closedDb as never,
      auth: { orgId: "org-1", userId: "user-1", role: "sales" },
      leadId: "lead-1",
      now: new Date("2026-08-10T17:00:00.000Z"), // 21:00 Asia/Baku
    })
    expect(closed.preflight.blockers).toContain("outside_calling_hours")
    expect(closed.preflight.blockers).not.toContain("voice_calling_hours_unconfigured")
  })

  it("requires explicit per-call attestation when no durable consent exists", async () => {
    const db = policyDb()
    const evaluation = await evaluateManualLeadAiCallPolicy({
      db: db as never,
      auth: { orgId: "org-1", userId: "user-1", role: "sales" },
      leadId: "lead-1",
      now: OPEN_NOW,
    })
    expect(evaluation.preflight).toMatchObject({
      eligible: true,
      blockers: [],
      requiresConsentConfirmation: true,
      limits: {
        userRemaining: null,
        organizationRemaining: null,
      },
    })
    expect(db.voiceCallSession.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: "org-1",
        OR: [
          { activeOrganizationKey: "org-1" },
          { activeLeadKey: "lead-1" },
          { activePhoneKey: "+994501234567" },
        ],
        // A dispatch that never completed leaves its active keys set forever,
        // and nothing else clears them: without this the lead stays uncallable
        // until someone edits the database by hand. Live calls are unaffected —
        // by then the status has moved past "dispatching".
        NOT: { status: "dispatching", leaseUntil: { lt: OPEN_NOW } },
      },
    }))
  })

  it("keeps an expired-lease uncertain session fail-closed for admin reconciliation", async () => {
    const db = policyDb({
      voiceCallSession: {
        findFirst: vi.fn().mockResolvedValue({
          id: "session-stale",
          status: "dispatch_uncertain",
          leaseUntil: new Date("2026-08-10T05:00:00.000Z"),
        }),
        count: vi.fn().mockResolvedValue(0),
      },
    })
    const evaluation = await evaluateManualLeadAiCallPolicy({
      db: db as never,
      auth: { orgId: "org-1", userId: "user-1", role: "sales" },
      leadId: "lead-1",
      now: OPEN_NOW,
    })
    expect(evaluation.preflight.blockers).toContain("active_call_exists")
  })

  it("does not start AI while an ordinary call to the same exact phone is unresolved", async () => {
    const db = policyDb({
      callLog: { findFirst: vi.fn().mockResolvedValue({ id: "human-unresolved" }) },
    })
    const evaluation = await evaluateManualLeadAiCallPolicy({
      db: db as never,
      auth: { orgId: "org-1", userId: "user-1", role: "sales" },
      leadId: "lead-1",
      now: OPEN_NOW,
    })

    expect(evaluation.preflight.blockers).toContain("active_call_exists")
    expect(db.callLog.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        direction: "outbound",
        targetPhoneE164: "+994501234567",
        callMode: { in: ["human"] },
        providerOutcome: null,
        OR: [
          { endedAt: null },
          { conversationOutcome: "provider_unknown_no_redial" },
        ],
      },
      select: { id: true },
    })

    const managerEvaluation = await evaluateManualLeadAiCallPolicy({
      db: db as never,
      auth: { orgId: "org-1", userId: "manager-1", role: "manager" },
      leadId: "lead-1",
      now: OPEN_NOW,
    })
    expect(managerEvaluation.preflight.canResolveUnknownCall).toBe(true)
  })

  it("exposes only a manual provider-unknown resolution handle to managers", async () => {
    const db = policyDb({
      voiceCallSession: {
        findFirst: vi.fn().mockResolvedValue({
          id: "session-unknown",
          leadId: "lead-1",
          status: "dispatch_uncertain",
          leaseUntil: null,
          blockReason: "provider_unknown_no_redial",
          callLogId: "call-log-unknown",
          queueItem: null,
        }),
        count: vi.fn().mockResolvedValue(0),
      },
    })
    const manager = await evaluateManualLeadAiCallPolicy({
      db: db as never,
      auth: { orgId: "org-1", userId: "manager-1", role: "manager" },
      leadId: "lead-1",
      now: OPEN_NOW,
    })
    expect(manager.preflight.canResolveUnknownCall).toBe(true)

    const seller = await evaluateManualLeadAiCallPolicy({
      db: db as never,
      auth: { orgId: "org-1", userId: "user-1", role: "sales" },
      leadId: "lead-1",
      now: OPEN_NOW,
    })
    expect(seller.preflight.canResolveUnknownCall).toBeUndefined()
  })

  it("lets a live suppression override seller attestation", async () => {
    const db = policyDb({
      voiceSuppression: { findMany: vi.fn().mockResolvedValue([{ id: "dnc-1" }]) },
    })
    const evaluation = await evaluateManualLeadAiCallPolicy({
      db: db as never,
      auth: { orgId: "org-1", userId: "user-1", role: "sales" },
      leadId: "lead-1",
      now: OPEN_NOW,
    })
    expect(evaluation.preflight.blockers).toContain("voice_opt_out")
    expect(evaluation.preflight.requiresConsentConfirmation).toBe(false)
  })
})
