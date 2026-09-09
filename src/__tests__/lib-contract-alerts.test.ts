/**
 * Tests for src/lib/integrations/contract-alerts.ts (CLM Slice 7a — hardened)
 *
 * sendContractAlert:
 *   - posts to active slack+teams configs with contractAlerts=true
 *   - skips inactive configs
 *   - skips configs without contractAlerts=true
 *   - org-scoped (only the org's configs)
 *   - best-effort: a webhook failure does NOT throw
 *   - best-effort: a prisma failure does NOT throw
 *   - FIX 4: title is omitted by default (PII opt-in)
 *   - FIX 4: title included when settings.includeContractTitle === true
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// ─── Mock prisma ────────────────────────────────────────────────────────────
vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: {
      findMany: vi.fn(),
    },
  },
}))

// ─── Mock sendSlackNotification + formatters ────────────────────────────────
vi.mock("@/lib/slack", () => ({
  sendSlackNotification: vi.fn().mockResolvedValue(true),
  formatContractSlackMessage: vi.fn().mockReturnValue({ text: "slack-msg", blocks: [] }),
  formatContractTeamsMessage: vi.fn().mockReturnValue({ summary: "teams-card", sections: [] }),
}))

// ─── Mock sendTeamsNotification ─────────────────────────────────────────────
vi.mock("@/lib/integrations/teams", () => ({
  sendTeamsNotification: vi.fn().mockResolvedValue(true),
}))

import { prisma } from "@/lib/prisma"
import { sendSlackNotification, formatContractSlackMessage, formatContractTeamsMessage } from "@/lib/slack"
import { sendTeamsNotification } from "@/lib/integrations/teams"
import { sendContractAlert } from "@/lib/integrations/contract-alerts"

const mockFindMany = prisma.channelConfig.findMany as ReturnType<typeof vi.fn>
const mockSendSlack = sendSlackNotification as ReturnType<typeof vi.fn>
const mockSendTeams = sendTeamsNotification as ReturnType<typeof vi.fn>
const mockFormatSlack = formatContractSlackMessage as ReturnType<typeof vi.fn>
const mockFormatTeams = formatContractTeamsMessage as ReturnType<typeof vi.fn>

const orgId = "org-test-123"
const contract = {
  contractNumber: "C-001",
  title: "Test Contract",
  valueAmount: 50000,
  currency: "USD",
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("sendContractAlert", () => {
  it("posts to active Slack config with contractAlerts=true", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "cfg-slack-1",
        channelType: "slack",
        webhookUrl: "https://hooks.slack.com/services/abc",
        isActive: true,
        settings: { contractAlerts: true },
      },
    ])

    await sendContractAlert(orgId, "contract.signed", contract)

    expect(mockSendSlack).toHaveBeenCalledTimes(1)
    expect(mockSendSlack).toHaveBeenCalledWith(
      "https://hooks.slack.com/services/abc",
      expect.any(Object),
    )
    expect(mockSendTeams).not.toHaveBeenCalled()
  })

  it("posts to active Teams config with contractAlerts=true", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "cfg-teams-1",
        channelType: "teams",
        webhookUrl: "https://outlook.office.com/webhook/abc",
        isActive: true,
        settings: { contractAlerts: true },
      },
    ])

    await sendContractAlert(orgId, "contract.approved", contract)

    expect(mockSendTeams).toHaveBeenCalledTimes(1)
    expect(mockSendTeams).toHaveBeenCalledWith(
      "https://outlook.office.com/webhook/abc",
      expect.any(Object),
    )
    expect(mockSendSlack).not.toHaveBeenCalled()
  })

  it("posts to both Slack and Teams configs in parallel", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "cfg-slack-1",
        channelType: "slack",
        webhookUrl: "https://hooks.slack.com/services/abc",
        isActive: true,
        settings: { contractAlerts: true },
      },
      {
        id: "cfg-teams-1",
        channelType: "teams",
        webhookUrl: "https://outlook.office.com/webhook/abc",
        isActive: true,
        settings: { contractAlerts: true },
      },
    ])

    await sendContractAlert(orgId, "contract.declined", contract)

    expect(mockSendSlack).toHaveBeenCalledTimes(1)
    expect(mockSendTeams).toHaveBeenCalledTimes(1)
  })

  it("skips configs with contractAlerts=false", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "cfg-slack-1",
        channelType: "slack",
        webhookUrl: "https://hooks.slack.com/services/abc",
        isActive: true,
        settings: { contractAlerts: false },
      },
    ])

    await sendContractAlert(orgId, "contract.signed", contract)

    expect(mockSendSlack).not.toHaveBeenCalled()
    expect(mockSendTeams).not.toHaveBeenCalled()
  })

  it("skips configs without contractAlerts key in settings", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "cfg-slack-1",
        channelType: "slack",
        webhookUrl: "https://hooks.slack.com/services/abc",
        isActive: true,
        settings: {},
      },
    ])

    await sendContractAlert(orgId, "contract.signed", contract)

    expect(mockSendSlack).not.toHaveBeenCalled()
  })

  it("skips configs with null settings", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "cfg-slack-1",
        channelType: "slack",
        webhookUrl: "https://hooks.slack.com/services/abc",
        isActive: true,
        settings: null,
      },
    ])

    await sendContractAlert(orgId, "contract.signed", contract)

    expect(mockSendSlack).not.toHaveBeenCalled()
  })

  it("is org-scoped: prisma findMany is called with the correct orgId", async () => {
    mockFindMany.mockResolvedValue([])

    await sendContractAlert(orgId, "contract.signed", contract)

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: orgId,
          isActive: true,
        }),
        take: 100, // bounded fan-out (DoS guard)
      }),
    )
  })

  it("best-effort: a webhook failure does NOT throw", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "cfg-slack-1",
        channelType: "slack",
        webhookUrl: "https://hooks.slack.com/services/abc",
        isActive: true,
        settings: { contractAlerts: true },
      },
    ])
    mockSendSlack.mockRejectedValue(new Error("Network error"))

    // Must not throw
    await expect(sendContractAlert(orgId, "contract.signed", contract)).resolves.toBeUndefined()
  })

  it("best-effort: sendSlackNotification returning false does NOT throw", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "cfg-slack-1",
        channelType: "slack",
        webhookUrl: "https://hooks.slack.com/services/abc",
        isActive: true,
        settings: { contractAlerts: true },
      },
    ])
    mockSendSlack.mockResolvedValue(false)

    await expect(sendContractAlert(orgId, "contract.signed", contract)).resolves.toBeUndefined()
  })

  it("best-effort: a prisma failure does NOT throw", async () => {
    mockFindMany.mockRejectedValue(new Error("DB connection lost"))

    await expect(sendContractAlert(orgId, "contract.signed", contract)).resolves.toBeUndefined()
  })

  it("does nothing when no eligible configs", async () => {
    mockFindMany.mockResolvedValue([])

    await sendContractAlert(orgId, "contract.signed", contract)

    expect(mockSendSlack).not.toHaveBeenCalled()
    expect(mockSendTeams).not.toHaveBeenCalled()
  })

  it("passes correct kind to formatContractSlackMessage", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "cfg-slack-1",
        channelType: "slack",
        webhookUrl: "https://hooks.slack.com/services/abc",
        isActive: true,
        settings: { contractAlerts: true },
      },
    ])

    await sendContractAlert(orgId, "contract.approval_requested", contract)

    expect(mockFormatSlack).toHaveBeenCalledWith(
      "contract.approval_requested",
      contract,
      expect.any(Object),
    )
  })

  it("passes correct kind to formatContractTeamsMessage", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "cfg-teams-1",
        channelType: "teams",
        webhookUrl: "https://outlook.office.com/webhook/abc",
        isActive: true,
        settings: { contractAlerts: true },
      },
    ])

    await sendContractAlert(orgId, "contract.renewal_due", contract)

    expect(mockFormatTeams).toHaveBeenCalledWith(
      "contract.renewal_due",
      contract,
      expect.any(Object),
    )
  })

  // ─── FIX 4: title opt-in ────────────────────────────────────────────────────

  it("FIX4: title is omitted by default (includeTitle=false)", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "cfg-slack-1",
        channelType: "slack",
        webhookUrl: "https://hooks.slack.com/services/abc",
        isActive: true,
        settings: { contractAlerts: true },
        // no includeContractTitle
      },
    ])

    await sendContractAlert(orgId, "contract.signed", contract)

    expect(mockFormatSlack).toHaveBeenCalledWith(
      "contract.signed",
      contract,
      { includeTitle: false },
    )
  })

  it("FIX4: title included when settings.includeContractTitle=true", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "cfg-slack-1",
        channelType: "slack",
        webhookUrl: "https://hooks.slack.com/services/abc",
        isActive: true,
        settings: { contractAlerts: true, includeContractTitle: true },
      },
    ])

    await sendContractAlert(orgId, "contract.signed", contract)

    expect(mockFormatSlack).toHaveBeenCalledWith(
      "contract.signed",
      contract,
      { includeTitle: true },
    )
  })

  it("FIX4: title excluded for Teams when includeContractTitle not set", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "cfg-teams-1",
        channelType: "teams",
        webhookUrl: "https://outlook.office.com/webhook/abc",
        isActive: true,
        settings: { contractAlerts: true },
      },
    ])

    await sendContractAlert(orgId, "contract.approved", contract)

    expect(mockFormatTeams).toHaveBeenCalledWith(
      "contract.approved",
      contract,
      { includeTitle: false },
    )
  })

  it("FIX4: title included for Teams when includeContractTitle=true", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "cfg-teams-1",
        channelType: "teams",
        webhookUrl: "https://outlook.office.com/webhook/abc",
        isActive: true,
        settings: { contractAlerts: true, includeContractTitle: true },
      },
    ])

    await sendContractAlert(orgId, "contract.approved", contract)

    expect(mockFormatTeams).toHaveBeenCalledWith(
      "contract.approved",
      contract,
      { includeTitle: true },
    )
  })
})
