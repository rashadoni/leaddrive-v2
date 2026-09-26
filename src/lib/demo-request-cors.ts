const ALLOWED_DEMO_REQUEST_ORIGINS = new Set([
  "https://leaddrivecrm.org",
  // Keep the aliases until the marketing-domain redirects are live and
  // verified. CORS compares the exact page origin, not the eventual target.
  "https://www.leaddrivecrm.org",
  "https://new.leaddrivecrm.org",
])

export const DEMO_REQUEST_ALLOWED_METHODS = "POST, OPTIONS"
export const DEMO_REQUEST_ALLOWED_HEADERS = "Content-Type"
export const DEMO_REQUEST_PREFLIGHT_MAX_AGE_SECONDS = 86_400

export function isDemoRequestApiPath(pathname: string): boolean {
  return pathname === "/api/v1/public/demo-requests" || pathname === "/api/v1/demo-request"
}

function varyByOrigin(headers: Headers): void {
  const vary = headers.get("Vary")
  if (!vary) {
    headers.set("Vary", "Origin")
    return
  }

  const fields = vary.split(",").map((field) => field.trim().toLowerCase())
  if (!fields.includes("origin") && !fields.includes("*")) {
    headers.set("Vary", `${vary}, Origin`)
  }
}

/**
 * Adds the public demo form's exact-origin CORS policy to a response.
 *
 * An absent or unlisted Origin is never reflected. CORS is a browser response
 * policy, not authentication, so the route keeps its existing server-to-server
 * behavior while browsers receive access only from the reviewed marketing
 * origins.
 */
export function withDemoRequestCors<T extends Response>(request: Pick<Request, "headers">, response: T): T {
  varyByOrigin(response.headers)

  const origin = request.headers.get("Origin")
  if (origin && ALLOWED_DEMO_REQUEST_ORIGINS.has(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin)
  } else {
    response.headers.delete("Access-Control-Allow-Origin")
  }

  return response
}
