/**
 * CLM Slice 7d — E-sign provider seam.
 *
 * Defines the EsignProvider interface and the DocuSign config-gated stub.
 * The native flow (HMAC token + sign portal) is NOT reimplemented here —
 * for "native" the resolver returns null, signalling the send route to
 * use the existing hardened native path byte-for-byte unchanged.
 *
 * DocuSign is an HONEST STUB: each method throws a clear "needs credentials"
 * error. The real DocuSign impl requires the user's OAuth app
 * (clientId / clientSecret / accountId) + the OAuth 2.0 exchange —
 * see [P3] in memory/deferred_findings.md.
 *
 * SENDING via external providers is currently HARD-GATED in the send route
 * (early 501 before any config/envelope touch) until the provider path
 * replicates ALL native invariants (binding, CAS, state-machine, audit).
 * The config CRUD, resolver, and UI remain active — operators may store
 * DocuSign credentials; only SENDING is disabled.
 *
 * How to add a new provider (once the gate is lifted):
 *   1. Implement EsignProvider (replicate ALL six PARITY INVARIANTS from
 *      the send route header comment).
 *   2. Add a case in getEsignProvider().
 *   3. Add the corresponding EsignProviderConfig row via the CRUD API.
 *   4. Remove the early-501 guard in the send route.
 */

import { prisma } from "@/lib/prisma"
import { decryptForTenant } from "@/lib/crypto/tenant-pii-encryption"

// ─── Provider interface ───────────────────────────────────────────────────────

/**
 * Common interface for all external e-sign providers.
 *
 * Each method receives the decrypted creds object at call time (never
 * stored in plaintext outside the call stack).
 *
 * "native" does NOT implement this interface — the native flow remains
 * the default path in the send route and is not abstracted here.
 */
export interface EsignProvider {
  /**
   * Create and send an envelope via the external provider.
   * Returns the provider's envelope ID for status polling.
   */
  send(
    envelope: { id: string; subject: string; message?: string | null },
    signers: Array<{ fullName: string; email: string; order: number }>,
    creds: Record<string, string>
  ): Promise<{ externalId: string }>

  /**
   * Poll the current status of an envelope from the provider.
   * Returns a normalised status string.
   */
  getStatus(externalId: string, creds: Record<string, string>): Promise<string>

  /**
   * Download the completed signed PDF from the provider.
   * Returns the raw PDF bytes.
   */
  downloadSignedPdf(externalId: string, creds: Record<string, string>): Promise<Buffer>
}

// ─── DocuSign stub ────────────────────────────────────────────────────────────

/**
 * DocuSign provider — config-gated STUB.
 *
 * Each method throws a clear "needs credentials" error until the user
 * configures their DocuSign OAuth app via
 * POST /api/v1/integrations/esign-provider.
 *
 * The real implementation needs:
 *   • DocuSign OAuth 2.0 PKCE exchange (GET /oauth/auth → POST /oauth/token)
 *   • eSignature REST API v2.1:
 *       POST /accounts/{accountId}/envelopes  — create+send
 *       GET  /accounts/{accountId}/envelopes/{envelopeId}  — status
 *       GET  /accounts/{accountId}/envelopes/{envelopeId}/documents/combined  — PDF
 *   • Token refresh (access_token TTL = 8h)
 * See [P2] in memory/deferred_findings.md.
 */
export class DocuSignProvider implements EsignProvider {
  private static readonly NEEDS_CREDS_MSG =
    "DocuSign integration requires OAuth credentials — configure in Settings → Integrations → E-Signature Provider"

  async send(
    _envelope: { id: string; subject: string; message?: string | null },
    _signers: Array<{ fullName: string; email: string; order: number }>,
    _creds: Record<string, string>
  ): Promise<{ externalId: string }> {
    throw new Error(DocuSignProvider.NEEDS_CREDS_MSG)
  }

  async getStatus(_externalId: string, _creds: Record<string, string>): Promise<string> {
    throw new Error(DocuSignProvider.NEEDS_CREDS_MSG)
  }

  async downloadSignedPdf(_externalId: string, _creds: Record<string, string>): Promise<Buffer> {
    throw new Error(DocuSignProvider.NEEDS_CREDS_MSG)
  }
}

// ─── Provider registry ────────────────────────────────────────────────────────

/** Singleton instances — providers are stateless. */
const PROVIDERS: Record<string, EsignProvider> = {
  docusign: new DocuSignProvider(),
}

/**
 * Return the provider instance for the given name, or null for "native".
 * Throws on an unrecognised provider name (defensive).
 */
export function getEsignProvider(name: string): EsignProvider | null {
  if (name === "native") return null
  const provider = PROVIDERS[name]
  if (!provider) throw new Error(`Unknown e-sign provider: "${name}"`)
  return provider
}

// ─── Resolver: pick provider for an org+request ──────────────────────────────

/**
 * Determine which e-sign provider to use for a given org + requested
 * provider name.
 *
 * Rules:
 *   • If requestedProvider === "native" (or absent) → return null (use native).
 *   • If requestedProvider === "docusign" (or another external name):
 *       – Look up an active EsignProviderConfig(docusign) for the org.
 *       – If found → return { provider, rawCreds } (creds decrypted just-in-time).
 *       – If not found → return null (fall back to native; caller can 400 instead).
 *   • "rawCreds" is the decrypted JSON object — NEVER stored outside the
 *     call stack; discarded after send.
 */
export async function resolveEsignProvider(
  orgId: string,
  requestedProvider: string | undefined | null
): Promise<
  | { provider: null; config: null }
  | { provider: EsignProvider; config: { id: string; provider: string; rawCreds: Record<string, string> } }
> {
  // Default / explicit native → always native
  if (!requestedProvider || requestedProvider === "native") {
    return { provider: null, config: null }
  }

  // Look up active config for the requested provider
  const configRow = await prisma.esignProviderConfig.findFirst({
    where: { organizationId: orgId, provider: requestedProvider, isActive: true },
    select: { id: true, provider: true, config: true },
  })

  if (!configRow) {
    // No active config → caller decides (fall back to native or return 4xx)
    return { provider: null, config: null }
  }

  // Decrypt creds just-in-time — only live on the stack during the call
  let rawCreds: Record<string, string>
  try {
    rawCreds = JSON.parse(decryptForTenant(orgId, configRow.config))
  } catch {
    throw new Error(
      `Failed to decrypt EsignProviderConfig for provider "${requestedProvider}" — config may be corrupt`
    )
  }

  const providerInstance = getEsignProvider(configRow.provider)
  if (!providerInstance) {
    // Should not happen — "native" cannot be stored in EsignProviderConfig
    throw new Error(`EsignProviderConfig has provider "native" — this is invalid`)
  }

  return {
    provider: providerInstance,
    config: { id: configRow.id, provider: configRow.provider, rawCreds },
  }
}

// ─── Error sentinel ───────────────────────────────────────────────────────────

/** Type-guard: is this the DocuSign needs-credentials signal? */
export function isNeedsCredsError(err: unknown): boolean {
  return (
    err instanceof Error &&
    err.message.includes("requires OAuth credentials")
  )
}
