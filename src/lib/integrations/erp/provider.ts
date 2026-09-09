/**
 * CLM Slice 7c — ERP-export provider seam.
 *
 * Design goals
 * ============
 * • ErpProvider interface: one method `pushInvoice(invoice, config)`.
 * • Registry: looks up the org's active AccountingIntegration, dispatches
 *   to the right provider.
 * • OneCErpProvider: reuses the existing 1c-erp/connector.ts adapter pattern
 *   (env-gated: ERP_API_URL / ERP_API_KEY). If unset → skipped, no-op.
 * • QuickBooksErpProvider / XeroErpProvider: honest stubs. They return a
 *   clear "needs OAuth credentials" signal — no fake integration.
 * • pushInvoiceToErp(orgId, invoiceId): best-effort, NEVER throws into the
 *   caller. Returns { skipped: true } when nothing is configured.
 *
 * [P2] DECLARED DEFERRED:
 *   QuickBooks/Xero OAuth credential flow is pending the user supplying
 *   OAuth client_id/secret. 1C works when ERP_API_URL + ERP_API_KEY are set.
 *   AccountingIntegration.config encryption is also deferred (P2).
 *
 * Env vars (1C path)
 * ==================
 * ERP_API_URL   – base URL of the 1C REST/OData service
 * ERP_API_KEY   – shared secret (x-erp-api-key header)
 */

import { prisma } from "@/lib/prisma"
import { logWarn } from "@/lib/logger"
import {
  OutboundWebhookSecurityError,
  requestOutboundWebhook,
  validateOutboundWebhookUrl,
} from "@/lib/integrations/webhook-url-guard"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ErpInvoicePayload {
  invoiceId: string
  invoiceNumber: string
  orgId: string
  title: string
  /** ISO 8601 string */
  issueDate: string
  /** ISO 8601 string or null */
  dueDate: string | null
  /** Decimal string to avoid float — callers pass .toString() from Prisma.Decimal */
  totalAmount: string
  currency: string
}

export interface ErpPushResult {
  /** true when the provider is not configured — safe no-op */
  skipped?: boolean
  /** External ERP document ID (present on success) */
  externalId?: string
  /** Provider-level signal for unconfigured stubs */
  message?: string
}

// ---------------------------------------------------------------------------
// ErpProvider interface
// ---------------------------------------------------------------------------

export interface ErpProvider {
  /**
   * Push an invoice to the external ERP system.
   * Returns { skipped: true } when the provider is unconfigured.
   * Throws on unrecoverable errors (the caller wraps in best-effort catch).
   */
  pushInvoice(
    invoice: ErpInvoicePayload,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: Record<string, any>,
  ): Promise<ErpPushResult>
}

// ---------------------------------------------------------------------------
// 1C ERP Provider (reuses connector pattern)
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3
const BASE_DELAY_MS = 500
const PER_ATTEMPT_TIMEOUT_MS = 10_000
const MAX_ERP_RESPONSE_BYTES = 64 * 1024

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function oneCFetch(
  url: string,
  body: unknown,
  apiKey: string,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await requestOutboundWebhook(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-erp-api-key": apiKey,
    },
    body: JSON.stringify(body),
    allowHttp: false,
    timeoutMs: PER_ATTEMPT_TIMEOUT_MS,
    maxResponseBytes: MAX_ERP_RESPONSE_BYTES,
    // A cross-origin redirect may be followed only after the shared transport
    // removes the ERP credential from the next hop.
    sensitiveHeaders: ["x-erp-api-key"],
  })
  let data: unknown = {}
  if (res.bodyText) {
    try {
      data = JSON.parse(res.bodyText)
    } catch {
      data = {}
    }
  }
  return { ok: res.ok, status: res.status, data }
}

async function oneCFetchWithRetry(
  url: string,
  body: unknown,
  apiKey: string,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  let lastError: unknown

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await oneCFetch(url, body, apiKey)
      if (result.ok) return result

      // 4xx — non-retryable; do NOT embed result.data (may contain remote-echoed sensitive info)
      if (result.status >= 400 && result.status < 500) {
        throw new Error(
          `1C ERP client error: HTTP ${result.status}`,
        )
      }

      lastError = new Error(`1C ERP server error: HTTP ${result.status}`)
    } catch (err) {
      // SSRF policy failures are deterministic and must never be retried.
      if (err instanceof OutboundWebhookSecurityError) throw err
      const message = err instanceof Error ? err.message : String(err)
      if (message.startsWith("1C ERP client error")) throw err
      lastError = err
    }

    if (attempt < MAX_RETRIES) {
      await sleep(BASE_DELAY_MS * 2 ** (attempt - 1))
    }
  }

  throw new Error(
    `1C ERP push failed after ${MAX_RETRIES} retries: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  )
}

export const OneCErpProvider: ErpProvider = {
  async pushInvoice(
    invoice: ErpInvoicePayload,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: Record<string, any>,
  ): Promise<ErpPushResult> {
    // Select URL + credential as one provenance-bound pair. A global key must
    // never be combined with a tenant-selected URL (and vice versa).
    const envUrl = process.env.ERP_API_URL?.trim() || ""
    const envApiKey = process.env.ERP_API_KEY?.trim() || ""
    const tenantUrl = typeof config?.apiUrl === "string" ? config.apiUrl.trim() : ""
    const tenantApiKey = typeof config?.apiKey === "string" ? config.apiKey : ""
    let baseUrl: string
    let apiKey: string
    if (envUrl || envApiKey) {
      if (!envUrl || !envApiKey) {
        return { skipped: true, message: "ERP_API_URL and ERP_API_KEY must be configured together" }
      }
      baseUrl = envUrl
      apiKey = envApiKey
    } else {
      if (!tenantUrl || !tenantApiKey.trim()) {
        return { skipped: true, message: "Tenant ERP API URL and key must be configured together" }
      }
      baseUrl = tenantUrl
      apiKey = tenantApiKey
    }

    const url = `${baseUrl.replace(/\/+$/, "")}/invoices`

    // SECURITY: resolve and reject private/loopback/metadata hosts before the
    // first attempt. Every attempt and redirect is then resolved again and
    // socket-pinned by requestOutboundWebhook, closing DNS-rebinding races.
    try {
      await validateOutboundWebhookUrl(url, { allowHttp: false })
    } catch {
      logWarn(
        `[OneCErpProvider] ERP URL rejected (unsafe host) for org ${invoice.orgId}`,
        { module: "erp-provider", org_id: invoice.orgId },
      )
      return { skipped: true, message: "ERP URL rejected (unsafe host)" }
    }

    const payload = {
      invoiceId: invoice.invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      organizationId: invoice.orgId,
      title: invoice.title,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      totalAmount: invoice.totalAmount,
      currency: invoice.currency,
    }

    const result = await oneCFetchWithRetry(url, payload, apiKey)
    const erpData = result.data as Record<string, unknown> | null
    const externalId: string | undefined =
      (erpData?.id as string | undefined) ??
      (erpData?.erpId as string | undefined)

    if (!externalId) {
      logWarn(
        `[OneCErpProvider] pushInvoice: ERP response missing id/erpId for invoice ${invoice.invoiceId}`,
        { module: "erp-provider", org_id: invoice.orgId },
      )
      return {}
    }

    return { externalId }
  },
}

// ---------------------------------------------------------------------------
// QuickBooks ERP Provider — stub (OAuth credentials not yet configured)
// ---------------------------------------------------------------------------

export const QuickBooksErpProvider: ErpProvider = {
  async pushInvoice(
    invoice: ErpInvoicePayload,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _config: Record<string, any>,
  ): Promise<ErpPushResult> {
    // [P2] QuickBooks OAuth credentials not yet provided.
    // Configure client_id / client_secret / refresh_token in AccountingIntegration.config
    // to enable this path.
    logWarn(
      `[QuickBooksErpProvider] Invoice ${invoice.invoiceId} not pushed — needs OAuth credentials. Configure in AccountingIntegration.config (client_id, client_secret, refresh_token).`,
      { module: "erp-provider", org_id: invoice.orgId },
    )
    return {
      skipped: true,
      message:
        "QuickBooks ERP push requires OAuth credentials — configure client_id/client_secret/refresh_token in AccountingIntegration.config",
    }
  },
}

// ---------------------------------------------------------------------------
// Xero ERP Provider — stub (OAuth credentials not yet configured)
// ---------------------------------------------------------------------------

export const XeroErpProvider: ErpProvider = {
  async pushInvoice(
    invoice: ErpInvoicePayload,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _config: Record<string, any>,
  ): Promise<ErpPushResult> {
    // [P2] Xero OAuth credentials not yet provided.
    logWarn(
      `[XeroErpProvider] Invoice ${invoice.invoiceId} not pushed — needs OAuth credentials. Configure in AccountingIntegration.config (client_id, client_secret, refresh_token, tenant_id).`,
      { module: "erp-provider", org_id: invoice.orgId },
    )
    return {
      skipped: true,
      message:
        "Xero ERP push requires OAuth credentials — configure client_id/client_secret/refresh_token/tenant_id in AccountingIntegration.config",
    }
  },
}

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

const PROVIDER_REGISTRY: Record<string, ErpProvider> = {
  "1c": OneCErpProvider,
  quickbooks: QuickBooksErpProvider,
  xero: XeroErpProvider,
}

// ---------------------------------------------------------------------------
// Public: pushInvoiceToErp
// ---------------------------------------------------------------------------

/**
 * Best-effort invoice push to the org's active AccountingIntegration ERP.
 *
 * • If the org has no active AccountingIntegration → { skipped: true }
 * • If the provider is not in the registry → { skipped: true } + warning log
 * • If the push succeeds → { externalId }
 * • If the push fails → throws (caller is responsible for catch — typically
 *   a void + .catch(() => {}) wrapper so failure NEVER propagates)
 *
 * Callers should always wrap: `void pushInvoiceToErp(...).catch(() => {})`
 */
export async function pushInvoiceToErp(
  orgId: string,
  invoiceId: string,
): Promise<ErpPushResult> {
  // Look up the org's active AccountingIntegration
  const integration = await prisma.accountingIntegration.findFirst({
    where: { organizationId: orgId, isActive: true },
    orderBy: { createdAt: "desc" },
  })

  if (!integration) {
    return { skipped: true }
  }

  const provider = PROVIDER_REGISTRY[integration.provider]
  if (!provider) {
    logWarn(
      `[pushInvoiceToErp] Unknown provider "${integration.provider}" for org ${orgId}`,
      { module: "erp-provider", org_id: orgId },
    )
    return { skipped: true, message: `Unknown ERP provider: ${integration.provider}` }
  }

  // Fetch the invoice for the payload
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, organizationId: orgId },
    select: {
      id: true,
      invoiceNumber: true,
      title: true,
      issueDate: true,
      dueDate: true,
      totalAmount: true,
      currency: true,
    },
  })

  if (!invoice) {
    logWarn(
      `[pushInvoiceToErp] Invoice ${invoiceId} not found for org ${orgId}`,
      { module: "erp-provider", org_id: orgId },
    )
    return { skipped: true }
  }

  const config =
    integration.config && typeof integration.config === "object"
      ? (integration.config as Record<string, unknown>)
      : {}

  const payload: ErpInvoicePayload = {
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    orgId,
    title: invoice.title,
    issueDate: invoice.issueDate.toISOString(),
    dueDate: invoice.dueDate?.toISOString() ?? null,
    // Decimal → string (no float coercion)
    totalAmount:
      invoice.totalAmount != null
        ? invoice.totalAmount.toString()
        : "0",
    currency: invoice.currency,
  }

  return provider.pushInvoice(payload, config as Record<string, unknown>)
}
