/**
 * The one place that decides which Chatwoot origin this server will talk to.
 *
 * This is NOT the generic SSRF guard's job and cannot be delegated to it.
 * `webhook-url-guard` stops the server reaching private/internal addresses;
 * `https://evil.example` is an ordinary public host and passes it. But the
 * Chatwoot base URL is tenant-supplied config, and every request built from it
 * carries the tenant's `api_access_token` plus customer message content. So the
 * host needs an allowlist on top of the SSRF check, not instead of it.
 *
 * It lives here because the rule existed in three copies — inbound polling, the
 * source guard, and (until 22bda1339) the outbound send path. The outbound copy
 * was dropped when raw fetch was replaced by requestOutboundWebhook, on the
 * reasonable-looking assumption that the new guard covered it. It did not, and
 * three copies is how that goes unnoticed. One copy, three callers.
 */

/**
 * Parse and vet a tenant-configured Chatwoot base URL.
 *
 * Returns the parsed URL when the origin is trusted, or null when it is not:
 * non-HTTPS, carrying credentials in the URL, unparseable, or a host outside
 * the allowlist. Callers decide what a null means for them — refuse the send,
 * skip the poll — but none of them may proceed without one.
 */
export function trustedChatwootBaseUrl(rawBaseUrl: unknown): URL | null {
  if (typeof rawBaseUrl !== "string" || !rawBaseUrl) return null

  let parsed: URL
  try {
    parsed = new URL(rawBaseUrl)
  } catch {
    return null
  }

  // `app.chatwoot.com` is the hosted service every tenant can use; anything
  // else has to be named by an operator in env, never by the tenant.
  const trustedHosts = new Set([
    "app.chatwoot.com",
    ...(process.env.CHATWOOT_POLL_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  ])

  // `host`, not `hostname`: the port is part of the identity, so a self-hosted
  // "support.example:8443" in the allowlist does not also permit port 80.
  // username/password are rejected outright — "https://user:pass@app.chatwoot.com"
  // reads as the trusted host to a human and is a credential-carrying request
  // to everything else.
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || !trustedHosts.has(parsed.host.toLowerCase())
  ) {
    return null
  }

  return parsed
}
