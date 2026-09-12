/**
 * PATCH /api/v1/settings/ai-features — entitlement guard.
 *
 * The flag written here lands in `Organization.features`, which
 * `moduleRecordFromOrgFields` turns into `modules[<flag>] = true` and `hasModule`
 * treats as an authoritative paid-module grant. So the regression these tests
 * pin is not "bad input rejected" — it is "a signed-in member cannot entitle
 * their own tenant to a module nobody sold them".
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: vi.fn() },
  },
  logAudit: vi.fn(),
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((r: any) => r instanceof NextResponse),
}))

vi.mock("@/lib/org-features", () => ({
  setOrgFeatureFlag: vi.fn(),
}))

vi.mock("@/lib/ai/support-settings-access", () => ({
  hasSupportAiSettingsEntitlement: vi.fn(),
}))

import { GET, PATCH } from "@/app/api/v1/settings/ai-features/route"
import { prisma, logAudit } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { setOrgFeatureFlag } from "@/lib/org-features"
import { hasSupportAiSettingsEntitlement } from "@/lib/ai/support-settings-access"
import {
  AI_AUTOMATION_FLAGS,
  INBOX_TOGGLE_FLAGS,
  MODULE_AI_TOGGLE_FLAGS,
  isToggleableFeatureFlag,
} from "@/lib/ai-feature-flags"
import { MODULE_REGISTRY, GROUP_MODULE_IDS } from "@/lib/modules"

const MOCK_ADMIN = { orgId: "org-1", userId: "user-1", role: "admin" as const, email: "a@b.c", name: "A" }

function patch(body: unknown) {
  return new Request("http://localhost/api/v1/settings/ai-features", {
    method: "PATCH",
    body: JSON.stringify(body),
  }) as any
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(MOCK_ADMIN as any)
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({ features: [] } as any)
  vi.mocked(hasSupportAiSettingsEntitlement).mockResolvedValue(true)
})

// ── Allowlist (pure) ─────────────────────────────────────────────────────────

describe("isToggleableFeatureFlag", () => {
  it("accepts every AI automation flag the settings page renders", () => {
    for (const flag of AI_AUTOMATION_FLAGS) {
      expect(isToggleableFeatureFlag(flag), flag).toBe(true)
    }
  })

  it("accepts the inbox toggles that share the endpoint", () => {
    for (const flag of INBOX_TOGGLE_FLAGS) {
      expect(isToggleableFeatureFlag(flag), flag).toBe(true)
    }
  })

  it("accepts the Omnichannel and Support master switches", () => {
    for (const flag of MODULE_AI_TOGGLE_FLAGS) {
      expect(isToggleableFeatureFlag(flag), flag).toBe(true)
    }
    expect(isToggleableFeatureFlag("aiAutoReply")).toBe(true)
    expect(isToggleableFeatureFlag("supportAiDisabled")).toBe(true)
  })

  it("accepts prefixed flags whose suffix is tenant data", () => {
    expect(isToggleableFeatureFlag("chatbotAutoReplyDisabled:whatsapp")).toBe(true)
    expect(isToggleableFeatureFlag("inboxLeadQualificationBoard:clx123abc")).toBe(true)
  })

  it("rejects a prefixed flag with an unbounded or unsafe suffix", () => {
    expect(isToggleableFeatureFlag(`inboxLeadQualificationBoard:${"x".repeat(65)}`)).toBe(false)
    expect(isToggleableFeatureFlag("chatbotAutoReplyDisabled:has space")).toBe(false)
    expect(isToggleableFeatureFlag("chatbotAutoReplyDisabled:")).toBe(false)
  })

  // The regression that matters: every id `hasModule` can grant must be refused,
  // including ids added to the registry after this test was written.
  it("rejects EVERY module id", () => {
    const moduleIds = [...new Set([...Object.keys(MODULE_REGISTRY), ...GROUP_MODULE_IDS])]
    expect(moduleIds.length).toBeGreaterThan(10)
    for (const id of moduleIds) {
      expect(isToggleableFeatureFlag(id), id).toBe(false)
    }
  })

  it("rejects unknown strings", () => {
    expect(isToggleableFeatureFlag("")).toBe(false)
    expect(isToggleableFeatureFlag("whatever")).toBe(false)
    expect(isToggleableFeatureFlag("ai_not_a_real_flag")).toBe(false)
    expect(isToggleableFeatureFlag("x".repeat(129))).toBe(false)
  })
})

// ── Route ────────────────────────────────────────────────────────────────────

describe("PATCH /api/v1/settings/ai-features", () => {
  it("refuses a non-admin role", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...MOCK_ADMIN, role: "viewer" } as any)
    const res = await PATCH(patch({ feature: "ai_daily_briefing", action: "add" }))
    expect(res.status).toBe(403)
    expect(setOrgFeatureFlag).not.toHaveBeenCalled()
  })

  it("refuses a module id and does not write it", async () => {
    const res = await PATCH(patch({ feature: "mtm", action: "add" }))
    expect(res.status).toBe(400)
    expect(setOrgFeatureFlag).not.toHaveBeenCalled()
  })

  it("refuses an unknown flag", async () => {
    const res = await PATCH(patch({ feature: "totally_made_up", action: "add" }))
    expect(res.status).toBe(400)
    expect(setOrgFeatureFlag).not.toHaveBeenCalled()
  })

  it("refuses a non-string feature", async () => {
    const res = await PATCH(patch({ feature: { toString: "x" }, action: "add" }))
    expect(res.status).toBe(400)
    expect(setOrgFeatureFlag).not.toHaveBeenCalled()
  })

  it("toggles an allowlisted flag and records who did it", async () => {
    const res = await PATCH(patch({ feature: "ai_daily_briefing", action: "add" }))
    expect(res.status).toBe(200)
    expect(setOrgFeatureFlag).toHaveBeenCalledWith("org-1", "ai_daily_briefing", true)
    expect(logAudit).toHaveBeenCalledWith(
      "org-1",
      "feature_flag_enabled",
      "organization",
      "org-1",
      "ai_daily_briefing",
      { userId: "user-1" },
    )
  })

  it("removes an allowlisted flag", async () => {
    const res = await PATCH(patch({ feature: "ai_daily_briefing", action: "remove" }))
    expect(res.status).toBe(200)
    expect(setOrgFeatureFlag).toHaveBeenCalledWith("org-1", "ai_daily_briefing", false)
  })

  it("requires both paid module grants before changing the Support switch", async () => {
    vi.mocked(hasSupportAiSettingsEntitlement).mockResolvedValue(false)

    const res = await PATCH(patch({ feature: "supportAiDisabled", action: "add" }))

    expect(res.status).toBe(403)
    expect(setOrgFeatureFlag).not.toHaveBeenCalled()
    expect(logAudit).not.toHaveBeenCalled()
  })

  it("records previous/new Support state and preserves the Omnichannel flag", async () => {
    vi.mocked(prisma.organization.findUnique)
      .mockResolvedValueOnce({ features: ["support", "ai", "aiAutoReply"] } as any)
      .mockResolvedValueOnce({ features: ["support", "ai", "aiAutoReply", "supportAiDisabled"] } as any)

    const res = await PATCH(patch({ feature: "supportAiDisabled", action: "add" }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.features).toContain("aiAutoReply")
    expect(logAudit).toHaveBeenCalledWith(
      "org-1",
      "feature_flag_enabled",
      "organization",
      "org-1",
      "supportAiDisabled",
      {
        userId: "user-1",
        oldValue: { supportAiEnabled: true },
        newValue: { supportAiEnabled: false },
      },
    )
  })

  it("does not create a duplicate audit entry for an idempotent retry", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ features: ["supportAiDisabled"] } as any)

    const res = await PATCH(patch({ feature: "supportAiDisabled", action: "add" }))

    expect(res.status).toBe(200)
    expect(setOrgFeatureFlag).toHaveBeenCalledTimes(1)
    expect(logAudit).not.toHaveBeenCalled()
  })
})

describe("GET /api/v1/settings/ai-features", () => {
  it("lets a Support operator read feature state through AI read permission", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...MOCK_ADMIN, role: "support" } as any)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ features: ["support", "ai"] } as any)

    const response = await GET(new Request("http://localhost/api/v1/settings/ai-features") as any)

    expect(response.status).toBe(200)
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "ai", "read")
    expect(await response.json()).toEqual({ data: { features: ["support", "ai"] } })
  })
})
