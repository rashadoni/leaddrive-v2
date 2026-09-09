/**
 * CLM Slice 7c — Unit tests for src/lib/integrations/erp/provider.ts
 *
 * Coverage:
 *   - pushInvoiceToErp no-ops (skipped=true) when org has no active AccountingIntegration
 *   - pushInvoiceToErp no-ops when provider is unknown
 *   - QuickBooksErpProvider.pushInvoice returns skipped + "needs OAuth credentials" message
 *   - XeroErpProvider.pushInvoice returns skipped + "needs OAuth credentials" message
 *   - OneCErpProvider.pushInvoice returns skipped when ERP_API_URL not set
 *   - OneCErpProvider.pushInvoice dispatches via the safe outbound transport
 *   - pushInvoiceToErp dispatches to 1C when org has an active 1c AccountingIntegration
 *   - assertSafeOutboundUrl rejects http://, IP literals, private/metadata ranges; accepts valid https ERP host
 *   - OneCErpProvider.pushInvoice returns skipped when apiUrl is an unsafe host
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockAccountingIntegrationFindFirst = vi.fn()
const mockInvoiceFindFirst = vi.fn()
const mockLogWarn = vi.fn()
const mockValidateOutboundWebhookUrl = vi.hoisted(() => vi.fn())
const mockRequestOutboundWebhook = vi.hoisted(() => vi.fn())

vi.mock("@/lib/prisma", () => ({
  prisma: {
    accountingIntegration: {
      findFirst: (...args: unknown[]) => mockAccountingIntegrationFindFirst(...args),
    },
    invoice: {
      findFirst: (...args: unknown[]) => mockInvoiceFindFirst(...args),
    },
  },
}))

vi.mock("@/lib/logger", () => ({
  logWarn: (...args: unknown[]) => mockLogWarn(...args),
}))

vi.mock("@/lib/integrations/webhook-url-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/webhook-url-guard")>()
  return {
    ...actual,
    validateOutboundWebhookUrl: mockValidateOutboundWebhookUrl,
    requestOutboundWebhook: mockRequestOutboundWebhook,
  }
})

// ─── Import after mocks ───────────────────────────────────────────────────────

import {
  pushInvoiceToErp,
  QuickBooksErpProvider,
  XeroErpProvider,
  OneCErpProvider,
  type ErpInvoicePayload,
} from "@/lib/integrations/erp/provider"
import { assertSafeOutboundUrl } from "@/lib/integrations/webhook-url-guard"

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG_ID = "org-test-1"

const sampleInvoice = {
  id: "inv-1",
  invoiceNumber: "INV-2026-00001",
  title: "Service Agreement 2026",
  issueDate: new Date("2026-06-08T00:00:00.000Z"),
  dueDate: new Date("2026-07-08T00:00:00.000Z"),
  totalAmount: { toString: () => "5000.0000" },
  currency: "AZN",
}

const samplePayload: ErpInvoicePayload = {
  invoiceId: "inv-1",
  invoiceNumber: "INV-2026-00001",
  orgId: ORG_ID,
  title: "Service Agreement 2026",
  issueDate: "2026-06-08T00:00:00.000Z",
  dueDate: "2026-07-08T00:00:00.000Z",
  totalAmount: "5000.0000",
  currency: "AZN",
}

beforeEach(() => {
  mockValidateOutboundWebhookUrl.mockReset()
  mockValidateOutboundWebhookUrl.mockImplementation(async (rawUrl: string) => ({
    url: new URL(rawUrl),
    addresses: [{ address: "93.184.216.34", family: 4 }],
  }))
  mockRequestOutboundWebhook.mockReset()
  mockRequestOutboundWebhook.mockResolvedValue({
    ok: true,
    status: 200,
    url: "https://1c.example.az/api/invoices",
    redirects: 0,
    bodyText: JSON.stringify({ id: "ERP-DEFAULT" }),
  })
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("pushInvoiceToErp", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: no active integration
    mockAccountingIntegrationFindFirst.mockResolvedValue(null)
    mockInvoiceFindFirst.mockResolvedValue(sampleInvoice)
  })

  it("returns { skipped: true } when org has no active AccountingIntegration", async () => {
    mockAccountingIntegrationFindFirst.mockResolvedValue(null)
    const result = await pushInvoiceToErp(ORG_ID, "inv-1")
    expect(result.skipped).toBe(true)
  })

  it("returns { skipped: true } when AccountingIntegration provider is unknown", async () => {
    mockAccountingIntegrationFindFirst.mockResolvedValue({
      id: "ai-1",
      organizationId: ORG_ID,
      provider: "sap_unknown",
      isActive: true,
      config: {},
    })
    const result = await pushInvoiceToErp(ORG_ID, "inv-1")
    expect(result.skipped).toBe(true)
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.stringContaining("Unknown provider"),
      expect.any(Object),
    )
  })

  it("returns { skipped: true } when invoice not found", async () => {
    mockAccountingIntegrationFindFirst.mockResolvedValue({
      id: "ai-1",
      organizationId: ORG_ID,
      provider: "1c",
      isActive: true,
      config: {},
    })
    mockInvoiceFindFirst.mockResolvedValue(null)
    const result = await pushInvoiceToErp(ORG_ID, "inv-missing")
    expect(result.skipped).toBe(true)
  })

  it("dispatches to 1C when org has active 1c integration", async () => {
    mockAccountingIntegrationFindFirst.mockResolvedValue({
      id: "ai-1",
      organizationId: ORG_ID,
      provider: "1c",
      isActive: true,
      config: { apiUrl: "https://1c.example.az/api", apiKey: "secret" },
    })

    mockRequestOutboundWebhook.mockResolvedValue({
      ok: true,
      status: 200,
      url: "https://1c.example.az/api/invoices",
      redirects: 0,
      bodyText: JSON.stringify({ id: "ERP-0042" }),
    })

    const result = await pushInvoiceToErp(ORG_ID, "inv-1")
    expect(result.skipped).toBeUndefined()
    expect(result.externalId).toBe("ERP-0042")
  })

  it("dispatches to QuickBooks stub via provider, which returns skipped", async () => {
    mockAccountingIntegrationFindFirst.mockResolvedValue({
      id: "ai-qb",
      organizationId: ORG_ID,
      provider: "quickbooks",
      isActive: true,
      config: {},
    })
    const result = await pushInvoiceToErp(ORG_ID, "inv-1")
    expect(result.skipped).toBe(true)
    expect(result.message).toContain("QuickBooks")
  })

  it("dispatches to Xero stub via provider, which returns skipped", async () => {
    mockAccountingIntegrationFindFirst.mockResolvedValue({
      id: "ai-xero",
      organizationId: ORG_ID,
      provider: "xero",
      isActive: true,
      config: {},
    })
    const result = await pushInvoiceToErp(ORG_ID, "inv-1")
    expect(result.skipped).toBe(true)
    expect(result.message).toContain("Xero")
  })
})

describe("QuickBooksErpProvider.pushInvoice", () => {
  it("returns skipped=true with a message mentioning OAuth credentials", async () => {
    const result = await QuickBooksErpProvider.pushInvoice(samplePayload, {})
    expect(result.skipped).toBe(true)
    expect(result.message).toContain("OAuth credentials")
    expect(result.message?.toLowerCase()).toContain("quickbooks")
  })
})

describe("XeroErpProvider.pushInvoice", () => {
  it("returns skipped=true with a message mentioning OAuth credentials", async () => {
    const result = await XeroErpProvider.pushInvoice(samplePayload, {})
    expect(result.skipped).toBe(true)
    expect(result.message).toContain("OAuth credentials")
    expect(result.message?.toLowerCase()).toContain("xero")
  })
})

describe("OneCErpProvider.pushInvoice", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.ERP_API_URL
    delete process.env.ERP_API_KEY
  })

  it("returns skipped=true when ERP_API_URL is not set (env + config both missing)", async () => {
    delete process.env.ERP_API_URL
    const result = await OneCErpProvider.pushInvoice(samplePayload, {})
    expect(result.skipped).toBe(true)
  })

  it("returns skipped=true when neither env nor config apiUrl is present", async () => {
    const result = await OneCErpProvider.pushInvoice(samplePayload, { someOtherKey: "x" })
    expect(result.skipped).toBe(true)
  })

  it("dispatches to ERP_API_URL when env var is set and the request succeeds", async () => {
    process.env.ERP_API_URL = "https://1c.example.az/api"
    process.env.ERP_API_KEY = "api-secret"

    mockRequestOutboundWebhook.mockResolvedValue({
      ok: true,
      status: 200,
      url: "https://1c.example.az/api/invoices",
      redirects: 0,
      bodyText: JSON.stringify({ id: "ERP-9999" }),
    })

    const result = await OneCErpProvider.pushInvoice(samplePayload, {})
    expect(result.externalId).toBe("ERP-9999")
    expect(result.skipped).toBeUndefined()

    // Verify the pinned outbound transport was called with a bounded response
    // and explicit redirect credential stripping.
    expect(mockRequestOutboundWebhook).toHaveBeenCalledWith(
      "https://1c.example.az/api/invoices",
      expect.objectContaining({
        method: "POST",
        allowHttp: false,
        headers: expect.objectContaining({ "x-erp-api-key": "api-secret" }),
        maxResponseBytes: 64 * 1024,
        sensitiveHeaders: ["x-erp-api-key"],
      }),
    )
  })

  it("uses config.apiUrl as fallback when env var is unset", async () => {
    delete process.env.ERP_API_URL
    delete process.env.ERP_API_KEY
    mockRequestOutboundWebhook.mockResolvedValue({
      ok: true,
      status: 200,
      url: "https://1c-config.example.az/api/invoices",
      redirects: 0,
      bodyText: JSON.stringify({ erpId: "ERP-FROM-CONFIG" }),
    })

    const result = await OneCErpProvider.pushInvoice(samplePayload, {
      apiUrl: "https://1c-config.example.az/api",
      apiKey: "config-key",
    })
    expect(result.externalId).toBe("ERP-FROM-CONFIG")
  })

  it("never combines a global ERP key with a tenant-selected URL", async () => {
    delete process.env.ERP_API_URL
    process.env.ERP_API_KEY = "global-secret"

    const result = await OneCErpProvider.pushInvoice(samplePayload, {
      apiUrl: "https://attacker.example.com/collect",
      apiKey: "tenant-key",
    })

    expect(result).toMatchObject({ skipped: true })
    expect(result.message).toContain("configured together")
    expect(mockValidateOutboundWebhookUrl).not.toHaveBeenCalled()
    expect(mockRequestOutboundWebhook).not.toHaveBeenCalled()
  })

  it("does not combine a global ERP URL with a tenant credential", async () => {
    process.env.ERP_API_URL = "https://global-erp.example.com/api"
    delete process.env.ERP_API_KEY

    const result = await OneCErpProvider.pushInvoice(samplePayload, {
      apiUrl: "https://tenant-erp.example.com/api",
      apiKey: "tenant-secret",
    })

    expect(result).toMatchObject({ skipped: true })
    expect(result.message).toContain("configured together")
    expect(mockRequestOutboundWebhook).not.toHaveBeenCalled()
  })

  it("does not dispatch a tenant ERP URL without its tenant credential", async () => {
    const result = await OneCErpProvider.pushInvoice(samplePayload, {
      apiUrl: "https://tenant-erp.example.com/api",
    })

    expect(result).toMatchObject({ skipped: true })
    expect(result.message).toContain("configured together")
    expect(mockValidateOutboundWebhookUrl).not.toHaveBeenCalled()
    expect(mockRequestOutboundWebhook).not.toHaveBeenCalled()
  })

  it("returns skipped=true without dispatch when config.apiUrl is an unsafe private IP", async () => {
    delete process.env.ERP_API_URL
    mockValidateOutboundWebhookUrl.mockRejectedValueOnce(
      new Error("Webhook URL resolves to a private address"),
    )

    const result = await OneCErpProvider.pushInvoice(samplePayload, {
      apiUrl: "https://192.168.1.100/erp",
      apiKey: "config-secret",
    })
    expect(result.skipped).toBe(true)
    expect(result.message).toContain("unsafe host")
    // The outbound transport must NOT have been called.
    expect(mockRequestOutboundWebhook).not.toHaveBeenCalled()
  })

  it("returns skipped=true without dispatch when ERP_API_URL points to metadata", async () => {
    process.env.ERP_API_URL = "https://169.254.169.254/latest/meta-data"
    process.env.ERP_API_KEY = "api-secret"
    mockValidateOutboundWebhookUrl.mockRejectedValueOnce(
      new Error("Webhook URL resolves to a private address"),
    )

    const result = await OneCErpProvider.pushInvoice(samplePayload, {})
    expect(result.skipped).toBe(true)
    expect(result.message).toContain("unsafe host")
    expect(mockRequestOutboundWebhook).not.toHaveBeenCalled()
  })
})

// ─── assertSafeOutboundUrl guard unit tests ───────────────────────────────────

describe("assertSafeOutboundUrl", () => {
  it("throws on http:// URL (not https)", () => {
    expect(() => assertSafeOutboundUrl("http://erp.example.com/api")).toThrow(/https/)
  })

  it("throws on IPv4 literal", () => {
    expect(() => assertSafeOutboundUrl("https://192.168.1.1/api")).toThrow()
  })

  it("throws on loopback 127.0.0.1", () => {
    expect(() => assertSafeOutboundUrl("https://127.0.0.1/api")).toThrow()
  })

  it("throws on localhost hostname", () => {
    expect(() => assertSafeOutboundUrl("https://localhost/api")).toThrow(/blocked host/)
  })

  it("throws on AWS/GCP metadata IP 169.254.169.254", () => {
    expect(() => assertSafeOutboundUrl("https://169.254.169.254/meta-data")).toThrow()
  })

  it("throws on RFC1918 10.x.x.x", () => {
    expect(() => assertSafeOutboundUrl("https://10.0.0.1/api")).toThrow()
  })

  it("throws on RFC1918 172.16.x.x", () => {
    expect(() => assertSafeOutboundUrl("https://172.20.0.1/api")).toThrow()
  })

  it("throws on IPv6 loopback ::1", () => {
    // URL parses [::1] → hostname "::1"
    expect(() => assertSafeOutboundUrl("https://[::1]/api")).toThrow()
  })

  it("accepts a valid https ERP hostname", () => {
    // Should NOT throw
    expect(() => assertSafeOutboundUrl("https://erp.contoso.com/api/invoices")).not.toThrow()
  })

  it("accepts a valid https ERP hostname with port", () => {
    expect(() => assertSafeOutboundUrl("https://1c.example.az:8443/api")).not.toThrow()
  })

  it("throws on invalid URL", () => {
    expect(() => assertSafeOutboundUrl("not-a-url")).toThrow(/Invalid/)
  })
})
