import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  organizationFindUnique: vi.fn(),
  runWithRlsBypass: vi.fn((fn: () => unknown) => fn()),
  runWithTenant: vi.fn((_organizationId: string, fn: () => unknown) => fn()),
  withTenantFence: vi.fn(),
  getMonitoringScenarios: vi.fn(),
  fetchVerifiedArticle: vi.fn(),
  ingestMentionWithResult: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: mocks.organizationFindUnique },
  },
}))

vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: mocks.runWithRlsBypass,
  runWithTenant: mocks.runWithTenant,
}))

vi.mock("@/lib/social/monitoring-import-fence", () => ({
  withSocialMonitoringTenantCollectionFence: mocks.withTenantFence,
}))

vi.mock("@/lib/social/monitoring-scenarios", () => ({
  getMonitoringScenarios: mocks.getMonitoringScenarios,
}))

vi.mock("@/lib/social/google-alerts-address", () => ({
  extractGoogleAlertsAddress: vi.fn(() => ({ ok: true, organizationId: "org-1" })),
}))

vi.mock("@/lib/social/google-alerts-email", () => ({
  isAuthenticatedGoogleAlertSender: vi.fn(() => true),
  parseGoogleAlertEmail: vi.fn(() => ({
    query: "Acme",
    candidates: [{ url: "https://example.az/acme" }],
  })),
}))

vi.mock("@/lib/social/web-news-article", () => ({
  fetchVerifiedWebNewsArticle: mocks.fetchVerifiedArticle,
}))

vi.mock("@/lib/social/ingest-mention", () => ({
  findMatchedKeyword: vi.fn(() => "Acme"),
  ingestMentionWithResult: mocks.ingestMentionWithResult,
}))

import { processGoogleAlertsInbound } from "@/lib/social/google-alerts-ingest"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.organizationFindUnique.mockResolvedValue({ id: "org-1" })
  mocks.withTenantFence.mockResolvedValue({
    allowed: false,
    reason: "social_monitoring_collection_blocked",
  })
})

describe("Google Alerts email clean-slate fence", () => {
  it("acknowledges a valid alert without fetching or ingesting articles while collection is blocked", async () => {
    const result = await processGoogleAlertsInbound({
      to: "google-alerts+signed@example.com",
      from: "googlealerts-noreply@google.com",
      headerFrom: "Google Alerts <googlealerts-noreply@google.com>",
      authenticationResults: "dkim=pass header.d=google.com",
      subject: "Google Alert – Acme",
      html: "<a href='https://example.az/acme'>Acme</a>",
    })

    expect(result).toEqual({
      recognized: true,
      status: 202,
      body: {
        success: false,
        skipped: "social_monitoring_collection_blocked",
      },
    })
    expect(mocks.runWithTenant).toHaveBeenCalledWith("org-1", expect.any(Function))
    expect(mocks.withTenantFence).toHaveBeenCalledWith("org-1", expect.any(Function))
    expect(mocks.getMonitoringScenarios).not.toHaveBeenCalled()
    expect(mocks.fetchVerifiedArticle).not.toHaveBeenCalled()
    expect(mocks.ingestMentionWithResult).not.toHaveBeenCalled()
  })
})
