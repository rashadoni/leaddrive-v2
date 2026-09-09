"use client"

/**
 * Local replacement for `signIn` from `next-auth/react`.
 *
 * WHY THIS EXISTS: the upstream client calls `getProviders()` — a fetch of
 * `/api/auth/providers` — from inside `signIn()`, purely to learn whether the
 * requested provider id is of type "credentials" (which POSTs to `/callback/…`)
 * or an OAuth/OIDC provider (which POSTs to `/signin/…`). That endpoint
 * enumerates every configured identity provider, with its sign-in and callback
 * URLs, to anonymous callers; a penetration test flagged it as authentication
 * metadata disclosure. The provider→endpoint mapping is static for this
 * application, so it is encoded below and the discovery request is dropped.
 * The endpoint itself is then refused in the Auth.js catch-all route.
 *
 * Everything else mirrors the upstream implementation deliberately: fetch the
 * CSRF token first, form-encode the POST, set `X-Auth-Return-Redirect` so the
 * server answers with JSON instead of a 302, and return the same result shape
 * callers already branch on (`ok`, `error`, `status`, `url`). Keep it that way
 * — divergence here shows up as a broken login, not as a type error.
 *
 * Adding a provider to `auth.ts` means adding it here too. There is no runtime
 * discovery to fall back on any more; an unknown id throws instead of silently
 * posting to the wrong endpoint.
 */

const PROVIDER_ENDPOINT = {
  credentials: "callback",
} as const

export type SignInProvider = keyof typeof PROVIDER_ENDPOINT

export interface SignInResult {
  error?: string
  code?: string
  status: number
  ok: boolean
  url: string | null
}

export interface SignInOptions {
  /** Where to land after a successful sign-in. Defaults to the current URL. */
  callbackUrl?: string
  /** `false` returns the result instead of navigating. Defaults to `true`. */
  redirect?: boolean
  /** Provider-specific fields, e.g. email/password for credentials. */
  [key: string]: unknown
}

/**
 * Tell any mounted `SessionProvider` to refetch.
 *
 * Upstream `signIn` ends a successful non-redirecting call by refreshing its
 * cached session; without that, `useSession()` can still report "unauthenticated"
 * on the page the user lands on, even though the cookie is set. The provider
 * subscribes to this BroadcastChannel and refetches on any message, so posting
 * to it reproduces the behaviour through a public surface.
 */
function notifySessionChanged(): void {
  try {
    if (typeof BroadcastChannel === "undefined") return
    const channel = new BroadcastChannel("next-auth")
    channel.postMessage({ event: "session", data: { trigger: "signin" } })
    channel.close()
  } catch {
    // A blocked or unsupported channel must never fail an otherwise good login.
  }
}

export async function getCsrfToken(): Promise<string> {
  const response = await fetch("/api/auth/csrf", { credentials: "same-origin" })
  if (!response.ok) return ""
  const data = await response.json().catch(() => null)
  return typeof data?.csrfToken === "string" ? data.csrfToken : ""
}

export async function signIn(
  provider: SignInProvider,
  options: SignInOptions = {},
): Promise<SignInResult | undefined> {
  const endpoint = PROVIDER_ENDPOINT[provider]
  if (!endpoint) throw new TypeError(`Unknown sign-in provider "${provider}"`)

  const { callbackUrl, redirect = true, ...providerParams } = options
  const redirectTo = callbackUrl ?? window.location.href

  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(providerParams)) {
    if (value !== undefined && value !== null) body.set(key, String(value))
  }
  body.set("csrfToken", await getCsrfToken())
  body.set("callbackUrl", redirectTo)

  const response = await fetch(`/api/auth/${endpoint}/${provider}`, {
    method: "post",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Auth-Return-Redirect": "1",
    },
    credentials: "same-origin",
    body,
  })

  const data = (await response.json().catch(() => null)) as { url?: string } | null

  if (redirect) {
    const target = data?.url ?? redirectTo
    window.location.href = target
    // A fragment-only change does not reload the document by itself.
    if (target.includes("#")) window.location.reload()
    return undefined
  }

  // Auth.js reports a rejected credential as a 200 whose `url` carries
  // `?error=…`, so the status alone never tells a caller that login failed.
  let error: string | undefined
  let code: string | undefined
  if (data?.url) {
    try {
      const parsed = new URL(data.url)
      error = parsed.searchParams.get("error") ?? undefined
      code = parsed.searchParams.get("code") ?? undefined
    } catch {
      // A malformed URL means we cannot prove the attempt succeeded.
      error = "CallbackRouteError"
    }
  } else {
    error = "CallbackRouteError"
  }

  if (!error && response.ok) notifySessionChanged()

  return {
    error,
    code,
    status: response.status,
    ok: response.ok && !error,
    url: error ? null : (data?.url ?? null),
  }
}
