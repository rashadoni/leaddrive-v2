import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * Pentest finding "Public Authentication Metadata Exposure".
 *
 * Two properties are load-bearing and both are asserted here:
 *   1. signing in never requests `/api/auth/providers`, so the endpoint can be
 *      removed without breaking login;
 *   2. the endpoint is actually refused, while the rest of the Auth.js routes
 *      still reach the framework.
 *
 * The first is the one that silently regresses: reinstating
 * `import { signIn } from "next-auth/react"` anywhere restores the discovery
 * fetch, login keeps working, and the finding quietly reopens.
 */

const ORIGIN = "https://app.leaddrivecrm.org"

function mockFetchOnce(responses: Record<string, unknown>) {
  const calls: string[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push(url)
    const key = Object.keys(responses).find((path) => url.includes(path))
    if (!key) throw new Error(`unexpected fetch: ${url}`)
    const payload = responses[key] as { status?: number; json?: unknown }
    return {
      ok: (payload.status ?? 200) < 400,
      status: payload.status ?? 200,
      json: async () => payload.json ?? {},
      __init: init,
    } as unknown as Response
  })
  vi.stubGlobal("fetch", fetchMock)
  return { calls, fetchMock }
}

describe("signIn without provider discovery", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      location: { href: `${ORIGIN}/login`, reload: vi.fn() },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it("never fetches the provider discovery endpoint", async () => {
    const { calls } = mockFetchOnce({
      "/api/auth/csrf": { json: { csrfToken: "csrf-value" } },
      "/api/auth/callback/credentials": { json: { url: `${ORIGIN}/` } },
    })

    const { signIn } = await import("@/lib/auth-signin")
    await signIn("credentials", { email: "a@b.co", password: "x", redirect: false })

    expect(calls.some((url) => url.includes("/api/auth/providers"))).toBe(false)
  })

  it("posts credentials to the callback route with csrf and callbackUrl", async () => {
    const { fetchMock } = mockFetchOnce({
      "/api/auth/csrf": { json: { csrfToken: "csrf-value" } },
      "/api/auth/callback/credentials": { json: { url: `${ORIGIN}/` } },
    })

    const { signIn } = await import("@/lib/auth-signin")
    await signIn("credentials", {
      email: "a@b.co",
      password: "secret",
      organizationSlug: "acme",
      redirect: false,
    })

    const [url, init] = fetchMock.mock.calls[1]
    expect(String(url)).toContain("/api/auth/callback/credentials")
    expect(init?.method).toBe("post")
    const body = (init?.body as URLSearchParams)
    expect(body.get("csrfToken")).toBe("csrf-value")
    expect(body.get("email")).toBe("a@b.co")
    expect(body.get("organizationSlug")).toBe("acme")
    expect(body.get("callbackUrl")).toBe(`${ORIGIN}/login`)
    // Auth.js only answers with JSON when this header is present; without it the
    // browser follows a 302 and the caller can never read the outcome.
    expect((init?.headers as Record<string, string>)["X-Auth-Return-Redirect"]).toBe("1")
  })

  it("refuses a federated provider — password is the only way in", async () => {
    const { fetchMock } = mockFetchOnce({
      "/api/auth/csrf": { json: { csrfToken: "csrf-value" } },
    })

    const { signIn } = await import("@/lib/auth-signin")
    // Cast: the type already rejects this, and the runtime guard is what stops
    // a stray string from silently posting to a route that no longer exists.
    await expect(signIn("google" as never, { redirect: false })).rejects.toThrow(/Unknown sign-in provider/)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("reports a rejected credential that Auth.js returns as HTTP 200", async () => {
    mockFetchOnce({
      "/api/auth/csrf": { json: { csrfToken: "csrf-value" } },
      "/api/auth/callback/credentials": {
        json: { url: `${ORIGIN}/login?error=CredentialsSignin&code=credentials` },
      },
    })

    const { signIn } = await import("@/lib/auth-signin")
    const result = await signIn("credentials", { email: "a@b.co", password: "no", redirect: false })

    expect(result?.error).toBe("CredentialsSignin")
    expect(result?.ok).toBe(false)
    expect(result?.url).toBeNull()
  })

  it("reports success when the returned URL carries no error", async () => {
    mockFetchOnce({
      "/api/auth/csrf": { json: { csrfToken: "csrf-value" } },
      "/api/auth/callback/credentials": { json: { url: `${ORIGIN}/` } },
    })

    const { signIn } = await import("@/lib/auth-signin")
    const result = await signIn("credentials", { email: "a@b.co", password: "ok", redirect: false })

    expect(result?.error).toBeUndefined()
    expect(result?.ok).toBe(true)
    expect(result?.url).toBe(`${ORIGIN}/`)
  })

  it("tells a mounted SessionProvider to refetch after a successful sign-in", async () => {
    mockFetchOnce({
      "/api/auth/csrf": { json: { csrfToken: "csrf-value" } },
      "/api/auth/callback/credentials": { json: { url: `${ORIGIN}/` } },
    })
    const postMessage = vi.fn()
    const close = vi.fn()
    vi.stubGlobal("BroadcastChannel", class {
      constructor(public name: string) {}
      postMessage = postMessage
      close = close
    })

    const { signIn } = await import("@/lib/auth-signin")
    await signIn("credentials", { email: "a@b.co", password: "ok", redirect: false })

    // Without this the cookie is set but `useSession()` can still report the
    // user as signed out on the page they land on.
    expect(postMessage).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it("does not announce a session change when the credential was rejected", async () => {
    mockFetchOnce({
      "/api/auth/csrf": { json: { csrfToken: "csrf-value" } },
      "/api/auth/callback/credentials": { json: { url: `${ORIGIN}/login?error=CredentialsSignin` } },
    })
    const postMessage = vi.fn()
    vi.stubGlobal("BroadcastChannel", class {
      constructor(public name: string) {}
      postMessage = postMessage
      close = vi.fn()
    })

    const { signIn } = await import("@/lib/auth-signin")
    await signIn("credentials", { email: "a@b.co", password: "no", redirect: false })

    expect(postMessage).not.toHaveBeenCalled()
  })

  it("treats a response without a URL as a failure rather than a silent success", async () => {
    mockFetchOnce({
      "/api/auth/csrf": { json: { csrfToken: "csrf-value" } },
      "/api/auth/callback/credentials": { json: {} },
    })

    const { signIn } = await import("@/lib/auth-signin")
    const result = await signIn("credentials", { email: "a@b.co", password: "ok", redirect: false })

    expect(result?.ok).toBe(false)
  })
})

describe("Auth.js route handler", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it("refuses provider discovery and passes every other route through", async () => {
    const upstream = vi.fn(async () => new Response("upstream", { status: 200 }))
    vi.doMock("@/lib/auth", () => ({ handlers: { GET: upstream, POST: upstream } }))

    const { GET } = await import("@/app/api/auth/[...nextauth]/route")

    const blocked = await GET(new Request(`${ORIGIN}/api/auth/providers`), {})
    expect(blocked.status).toBe(404)

    const trailingSlash = await GET(new Request(`${ORIGIN}/api/auth/providers/`), {})
    expect(trailingSlash.status).toBe(404)

    expect(upstream).not.toHaveBeenCalled()

    for (const path of ["csrf", "session", "signin/google", "callback/credentials"]) {
      const passed = await GET(new Request(`${ORIGIN}/api/auth/${path}`), {})
      expect(passed.status).toBe(200)
    }
    expect(upstream).toHaveBeenCalledTimes(4)
  })
})

describe("Auth.js renderable pages", () => {
  // The 2026-08 re-test found GET /api/auth/signout and GET /api/auth/verify-request
  // still serving the framework's stock, unbranded pages — an ~8 KB Auth.js
  // document, its own CSS, a fresh csrf cookie pair, and (for verify-request)
  // a "check your email" magic-link flow this product does not have.
  //
  // The cause is subtractive: `pages` overrides only the keys it lists, and
  // anything omitted silently falls back to the framework page. So the
  // assertion has to be "every renderable page is overridden", not "signOut is
  // set" — otherwise the next Auth.js version that adds a page reopens the
  // finding without changing a line of our code.
  const RENDERABLE_PAGES = ["signIn", "signOut", "error", "verifyRequest"] as const

  it("overrides every page Auth.js can render, so none falls back to the framework default", async () => {
    const { readFileSync } = await import("node:fs")
    const { resolve } = await import("node:path")
    const source = readFileSync(resolve(process.cwd(), "src/lib/auth.ts"), "utf8")

    const pagesBlock = source.match(/\n\s*pages:\s*\{([^}]*)\}/)?.[1]
    expect(pagesBlock).toBeDefined()

    for (const page of RENDERABLE_PAGES) {
      expect(pagesBlock).toMatch(new RegExp(`\\b${page}:\\s*"/login"`))
    }
  })
})
