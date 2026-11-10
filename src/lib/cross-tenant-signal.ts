/**
 * How a tab learns that it is open on one organisation while the browser is signed into another.
 *
 * The session cookie lives on `.leaddrivecrm.org` and holds ONE organisation — the last one signed
 * into. A tab of any other organisation keeps rendering, and the proxy refuses its API calls with
 * 401 (src/proxy.ts). A page navigation is redirected to `/login?error=cross-tenant` and explains
 * itself; the background calls had nowhere to say it, so the tab simply went quiet: empty lists,
 * buttons that do nothing, no reason given. Production 2026-11-10 17:43 Baku — three refusals of
 * `/api/v1/tasks` and `/api/v1/notifications` on the Zeytun host with a LeadDrive session, and from
 * the owner's side it looked like the workspace had broken.
 *
 * So the refusal carries its own code and the two slugs, and the browser turns that into a sentence.
 * Both slugs are already known to whoever receives this: one is their own session's, the other is in
 * the address bar.
 *
 * No imports: the proxy bundles this into the Edge runtime.
 */
export const CROSS_TENANT_CODE = "cross_tenant"

export type CrossTenantSignal = {
  /** The organisation the browser is signed into. */
  sessionSlug: string | null
  /** The organisation this tab is open on. */
  hostSlug: string | null
}

/** A subdomain label, which is all either slug may ever be. Anything else is dropped, not rendered. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/

function slug(value: unknown): string | null {
  return typeof value === "string" && SLUG.test(value) ? value : null
}

/**
 * The signal in an API answer, or null when the answer is not one. Only a 401 carrying this exact
 * code counts: an ordinary 401 means "sign in", which is a different sentence and a different fix.
 */
export function readCrossTenantSignal(status: number, body: unknown): CrossTenantSignal | null {
  if (status !== 401) return null
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  const record = body as Record<string, unknown>
  if (record.code !== CROSS_TENANT_CODE) return null
  return { sessionSlug: slug(record.sessionSlug), hostSlug: slug(record.hostSlug) }
}
