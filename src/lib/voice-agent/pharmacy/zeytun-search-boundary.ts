import { timingSafeEqual } from "node:crypto"
import { z } from "zod"

import { readJsonRequestWithinLimit } from "../../request-body-limit"
import { zeytunBalanceQuerySchema } from "./zeytun-available-balances"
import type { ZeytunBalanceCache } from "./zeytun-balance-cache"
import { validateZeytunCallContext, type ZeytunCallContext, type ZeytunCallLookup } from "./zeytun-call-context"

export const zeytunSearchConfigSchema = z.strictObject({
  enabled: z.boolean(), organizationId: z.string().min(1).max(128), channelConfigId: z.string().min(1).max(128),
  runtimeToken: z.string().min(32).max(1024).regex(/^[A-Za-z0-9._~-]+$/),
})
const envelopeSchema = z.strictObject({ callId: z.uuid(), query: zeytunBalanceQuerySchema })
export const searchRestrictions = { canResolveIdentity: false, canQuote: false, canSubmitTo1c: false, requiresOperatorReview: true } as const
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
export function searchResponse(body: unknown, status = 200) { return Response.json(body, { status, headers }) }
export function searchUnavailable() { return searchResponse({ status: "catalog_unavailable", candidates: [], ...searchRestrictions }, 503) }

export type ZeytunSearchBoundaryDependencies = {
  /** Fresh tenant-scoped CRM projection; no phone/name fallback. */
  loadCall: (lookup: ZeytunCallLookup) => Promise<unknown>
  clock?: () => number
}

/** Shared transport/call checks; each caller must separately authorize the data
 * scope in resolve. No default customer mapping or preview fallback exists.
 */
export function createZeytunSearchBoundary(input: unknown, dependencies: ZeytunSearchBoundaryDependencies,
  resolve: (call: ZeytunCallContext, query: z.infer<typeof zeytunBalanceQuerySchema>) => Response | Promise<Response>) {
  const configured = zeytunSearchConfigSchema.safeParse(input)
  if (!configured.success || !configured.data.enabled) return async () => searchUnavailable()
  const config = configured.data
  const expectedToken = Buffer.from(config.runtimeToken)
  const clock = dependencies.clock ?? Date.now
  let windowStart = clock()
  let requestsInWindow = 0
  let inFlight = 0
  const callsInWindow = new Map<string, number>()
  return async (request: Request): Promise<Response> => {
    const received = /^Bearer ([A-Za-z0-9._~-]{32,1024})$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? ""
    const token = Buffer.from(received)
    if (token.length !== expectedToken.length || !timingSafeEqual(token, expectedToken)) return searchResponse({ error: "unauthorized" }, 401)
    if (request.method !== "POST") return searchResponse({ error: "method_not_allowed" }, 405)
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return searchResponse({ error: "unsupported_content_type" }, 415)
    const now = clock()
    if (now - windowStart >= 60_000) {
      windowStart = now; requestsInWindow = 0; callsInWindow.clear()
    }
    if (inFlight >= 4 || requestsInWindow >= 120) return searchResponse({ error: "search_rate_limited" }, 429)
    requestsInWindow++; inFlight++
    try {
      const body = await readJsonRequestWithinLimit(request, 4096)
      if (!body.ok) return searchResponse({ error: "invalid_request" }, body.reason === "too_large" ? 413 : 400)
      const parsed = envelopeSchema.safeParse(body.value)
      if (!parsed.success) return searchResponse({ error: "invalid_request" }, 400)
      const { callId, query } = parsed.data
      const used = callsInWindow.get(callId) ?? 0
      if (used >= 30) return searchResponse({ error: "search_rate_limited" }, 429)
      callsInWindow.set(callId, used + 1)
      const expected: ZeytunCallLookup = {
        organizationId: config.organizationId, channelConfigId: config.channelConfigId, provider: "asterisk", providerCallId: callId,
      }
      const call = validateZeytunCallContext(await dependencies.loadCall(expected), expected, clock())
      if (!call) return searchResponse({ error: "call_not_eligible" }, 403)
      return await resolve(call, query)
    } catch {
      return searchUnavailable()
    } finally { inFlight-- }
  }
}

/** Model-facing allowlist: source scope, customer, stock, prices and credentials
 * never pass through, including in the separately authorized owner preview.
 */
export function projectZeytunSearchResult(result: ReturnType<ZeytunBalanceCache["search"]>) {
  return {
    status: result.status, candidateCount: result.candidateCount, needsNarrowing: result.candidateCount > 1,
    candidates: result.candidates.map(item => ({
      externalId: item.externalId, itemCode: item.itemCode, name: item.name, nameAz: item.nameAz, identityVerified: false,
    })),
    catalog: { version: result.cache.catalogVersion, observedAt: result.cache.observedAt,
      observationStatus: result.cache.observationStatus, sourceGeneratedAt: null, coverage: "unverified" },
    ...searchRestrictions,
  }
}
