/**
 * Tests for N17 Named Credentials slice 1 — pure crypto + apply + HTTP client.
 * No DB. No real network. Mocked fetcher.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { applyCredentialToHeaders } from "@/lib/credentials/apply"
import type { ResolvedCredential } from "@/lib/credentials/types"
import { SECRET_ALG_V1 } from "@/lib/credentials/types"
import {
  _resetFallbackWarningForTesting,
  decryptSecret,
  encryptSecret,
} from "@/lib/credentials/vault"
import {
  ExternalServiceError,
  callExternalService,
} from "@/lib/external-services/client"

const originalNodeEnv = process.env.NODE_ENV

// `process.env.NODE_ENV` is a getter/setter wrapper — assign directly
// rather than via Object.defineProperty (which Node rejects). The cast
// is necessary because TypeScript types NODE_ENV as a discriminated
// union that excludes mutation; at runtime it's a plain string.
function setNodeEnv(value: string | undefined): void {
  if (value === undefined) {
    delete (process.env as Record<string, string | undefined>).NODE_ENV
  } else {
    ;(process.env as Record<string, string>).NODE_ENV = value
  }
}

beforeEach(() => {
  delete process.env.CRED_VAULT_KEY
  _resetFallbackWarningForTesting()
  // Default to "test" so the prod hard-fail branch doesn't fire
  // unless an individual test opts in.
  setNodeEnv("test")
})

afterEach(() => {
  vi.restoreAllMocks()
  // Restore env so a test setting CRED_VAULT_KEY can't leak across
  // files if Vitest ever switches from per-file forks to threads.
  delete process.env.CRED_VAULT_KEY
  setNodeEnv(originalNodeEnv)
})

/* ─── vault.encryptSecret + decryptSecret ─────────────────────────────── */

describe("N17 — vault encrypt + decrypt round-trip", () => {
  it("decrypts a value encrypted under the same (orgId, name)", () => {
    const enc = encryptSecret({
      organizationId: "org_1",
      name: "stripe_api",
      plaintext: "sk_test_abc123",
    })
    const dec = decryptSecret({
      organizationId: "org_1",
      name: "stripe_api",
      encrypted: enc,
    })
    expect(dec).toBe("sk_test_abc123")
  })

  it("output is base64 for all three blob fields + carries the alg marker", () => {
    const enc = encryptSecret({
      organizationId: "org_x",
      name: "k",
      plaintext: "hello",
    })
    expect(enc.alg).toBe(SECRET_ALG_V1)
    expect(enc.ciphertext).toMatch(/^[A-Za-z0-9+/=]+$/)
    expect(enc.iv).toMatch(/^[A-Za-z0-9+/=]+$/)
    expect(enc.tag).toMatch(/^[A-Za-z0-9+/=]+$/)
  })

  it("IV is fresh per call and each nonce authenticates its ciphertext", () => {
    // A one-byte ciphertext can coincide under different IVs (about 1/256).
    // Assert nonce freshness and authenticated recovery, not ciphertext inequality.
    const a = encryptSecret({ organizationId: "o", name: "n", plaintext: "x" })
    const b = encryptSecret({ organizationId: "o", name: "n", plaintext: "x" })

    expect(a.iv).not.toBe(b.iv)
    expect(decryptSecret({ organizationId: "o", name: "n", encrypted: a })).toBe("x")
    expect(decryptSecret({ organizationId: "o", name: "n", encrypted: b })).toBe("x")
    expect(() =>
      decryptSecret({ organizationId: "o", name: "n", encrypted: { ...a, iv: b.iv } })
    ).toThrow()
  })

  it("AAD binds ciphertext to (orgId, name) — wrong orgId fails to decrypt", () => {
    const enc = encryptSecret({
      organizationId: "org_a",
      name: "n",
      plaintext: "x",
    })
    expect(() =>
      decryptSecret({
        organizationId: "org_b", // different org
        name: "n",
        encrypted: enc,
      })
    ).toThrow()
  })

  it("AAD binds ciphertext to (orgId, name) — wrong name fails to decrypt", () => {
    const enc = encryptSecret({
      organizationId: "o",
      name: "stripe",
      plaintext: "x",
    })
    expect(() =>
      decryptSecret({
        organizationId: "o",
        name: "twilio", // different name
        encrypted: enc,
      })
    ).toThrow()
  })

  it("tampered ciphertext fails GCM auth and throws", () => {
    const enc = encryptSecret({ organizationId: "o", name: "n", plaintext: "x" })
    // Flip a base64 byte in the middle of the ciphertext.
    const buf = Buffer.from(enc.ciphertext, "base64")
    buf[0] ^= 0xff
    const tampered = { ...enc, ciphertext: buf.toString("base64") }
    expect(() => decryptSecret({ organizationId: "o", name: "n", encrypted: tampered })).toThrow()
  })

  it("tampered tag fails decryption", () => {
    const enc = encryptSecret({ organizationId: "o", name: "n", plaintext: "x" })
    const buf = Buffer.from(enc.tag, "base64")
    buf[0] ^= 0xff
    const tampered = { ...enc, tag: buf.toString("base64") }
    expect(() => decryptSecret({ organizationId: "o", name: "n", encrypted: tampered })).toThrow()
  })

  it("throws on unknown alg marker (migration safety)", () => {
    const enc = encryptSecret({ organizationId: "o", name: "n", plaintext: "x" })
    expect(() =>
      decryptSecret({
        organizationId: "o",
        name: "n",
        encrypted: { ...enc, alg: "rot13-v0" as never },
      })
    ).toThrow(/Unsupported secret algorithm/)
  })

  it("throws on invalid IV length", () => {
    const enc = encryptSecret({ organizationId: "o", name: "n", plaintext: "x" })
    const badIv = Buffer.alloc(8, 0).toString("base64") // 8 bytes — wrong
    expect(() =>
      decryptSecret({ organizationId: "o", name: "n", encrypted: { ...enc, iv: badIv } })
    ).toThrow(/Invalid IV length/)
  })

  it("throws on empty plaintext (caller bug)", () => {
    expect(() => encryptSecret({ organizationId: "o", name: "n", plaintext: "" })).toThrow(
      /plaintext is empty/
    )
  })

  it("rejects malformed CRED_VAULT_KEY (not base64)", () => {
    process.env.CRED_VAULT_KEY = "not\x00valid\x00base64\xff"
    expect(() => encryptSecret({ organizationId: "o", name: "n", plaintext: "x" })).toThrow(
      /CRED_VAULT_KEY/
    )
  })

  it("rejects CRED_VAULT_KEY of wrong length", () => {
    // 16 bytes — wrong (need 32).
    process.env.CRED_VAULT_KEY = Buffer.alloc(16, 0).toString("base64")
    expect(() => encryptSecret({ organizationId: "o", name: "n", plaintext: "x" })).toThrow(
      /must decode to exactly 32 bytes/
    )
  })

  it("uses provided CRED_VAULT_KEY when set (decrypts under same key)", () => {
    const key = Buffer.alloc(32, 7).toString("base64")
    process.env.CRED_VAULT_KEY = key
    const enc = encryptSecret({ organizationId: "o", name: "n", plaintext: "secret-x" })
    const dec = decryptSecret({ organizationId: "o", name: "n", encrypted: enc })
    expect(dec).toBe("secret-x")
  })

  it("hard-fails in production when CRED_VAULT_KEY is missing", () => {
    setNodeEnv("production")
    delete process.env.CRED_VAULT_KEY
    _resetFallbackWarningForTesting()
    expect(() =>
      encryptSecret({ organizationId: "o", name: "n", plaintext: "x" })
    ).toThrow(/required in production/)
  })

  it("ciphertext encrypted under key A doesn't decrypt under key B", () => {
    const keyA = Buffer.alloc(32, 1).toString("base64")
    const keyB = Buffer.alloc(32, 2).toString("base64")
    process.env.CRED_VAULT_KEY = keyA
    const enc = encryptSecret({ organizationId: "o", name: "n", plaintext: "x" })
    process.env.CRED_VAULT_KEY = keyB
    expect(() =>
      decryptSecret({ organizationId: "o", name: "n", encrypted: enc })
    ).toThrow()
  })
})

/* ─── apply: build auth headers per authType ──────────────────────────── */

describe("N17 — applyCredentialToHeaders", () => {
  const mkCred = (over: Partial<ResolvedCredential>): ResolvedCredential => ({
    id: "c1",
    name: "test",
    organizationId: "o",
    baseUrl: "https://api.example.com",
    authType: "bearer",
    authConfig: {},
    secret: "tok_abc",
    ...over,
  })

  it("bearer → Authorization: Bearer <secret>", () => {
    const { headers } = applyCredentialToHeaders(mkCred({ authType: "bearer", secret: "tok_abc" }))
    expect(headers["authorization"]).toBe("Bearer tok_abc")
  })

  it("basic → Authorization: Basic base64(user:pass)", () => {
    const { headers } = applyCredentialToHeaders(
      mkCred({ authType: "basic", secret: "alice:hunter2" })
    )
    expect(headers["authorization"]).toBe(
      `Basic ${Buffer.from("alice:hunter2", "utf-8").toString("base64")}`
    )
  })

  it("basic rejects colon-less secret (malformed user:pass)", () => {
    expect(() =>
      applyCredentialToHeaders(mkCred({ authType: "basic", secret: "nocolon" }))
    ).toThrow(/user:pass/)
  })

  it("api_key_header uses authConfig.headerName + secret verbatim", () => {
    const { headers } = applyCredentialToHeaders(
      mkCred({
        authType: "api_key_header",
        authConfig: { headerName: "X-API-Key" },
        secret: "rawkey123",
      })
    )
    expect(headers["x-api-key"]).toBe("rawkey123")
  })

  it("api_key_header throws on missing headerName", () => {
    expect(() =>
      applyCredentialToHeaders(
        mkCred({ authType: "api_key_header", authConfig: {}, secret: "x" })
      )
    ).toThrow(/missing headerName/)
  })

  it("api_key_header throws on header-injection chars in headerName (CR/LF)", () => {
    expect(() =>
      applyCredentialToHeaders(
        mkCred({
          authType: "api_key_header",
          authConfig: { headerName: "X-Hack\r\nEvil" },
          secret: "x",
        })
      )
    ).toThrow(/disallowed character/)
  })

  it("none → no auth header added", () => {
    const { headers } = applyCredentialToHeaders(
      mkCred({ authType: "none", secret: null })
    )
    expect(headers["authorization"]).toBeUndefined()
  })

  it("caller-supplied Authorization wins over the credential", () => {
    const { headers } = applyCredentialToHeaders(
      mkCred({ authType: "bearer", secret: "from_vault" }),
      { Authorization: "Bearer override" }
    )
    expect(headers["authorization"]).toBe("Bearer override")
  })

  it("auth without secret on a non-none authType throws (corruption)", () => {
    expect(() =>
      applyCredentialToHeaders(mkCred({ authType: "bearer", secret: null }))
    ).toThrow(/no decrypted secret/)
  })

  it("lowercases caller header keys (case-insensitive HTTP semantics)", () => {
    const { headers } = applyCredentialToHeaders(
      mkCred({ authType: "none", secret: null }),
      { "Content-Type": "application/json", "X-FOO": "bar" }
    )
    expect(headers["content-type"]).toBe("application/json")
    expect(headers["x-foo"]).toBe("bar")
  })
})

/* ─── callExternalService (HTTP client with mocked fetcher) ───────────── */

function mkCred(over: Partial<ResolvedCredential> = {}): ResolvedCredential {
  return {
    id: "c1",
    name: "test",
    organizationId: "o",
    baseUrl: "https://api.example.com",
    authType: "bearer",
    authConfig: {},
    secret: "tok",
    ...over,
  }
}

function mockResponse({
  status = 200,
  headers = { "content-type": "application/json" },
  body = '{"ok":true}',
}: { status?: number; headers?: Record<string, string>; body?: string } = {}): Response {
  return new Response(body, { status, headers })
}

describe("N17 — callExternalService", () => {
  it("issues a request to the joined URL with bearer header", async () => {
    const fetcher = vi.fn().mockResolvedValue(mockResponse())
    const r = await callExternalService({
      credential: mkCred(),
      method: "GET",
      path: "/v1/charges",
      fetcher,
    })
    expect(fetcher).toHaveBeenCalledOnce()
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe("https://api.example.com/v1/charges")
    const reqInit = init as RequestInit & { headers: Record<string, string> }
    expect(reqInit.method).toBe("GET")
    expect(reqInit.headers.authorization).toBe("Bearer tok")
    expect(r.status).toBe(200)
    expect(r.ok).toBe(true)
    expect(r.body).toEqual({ ok: true })
  })

  it("strips named-credential and caller headers on a cross-origin redirect", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 307,
        headers: { location: "https://redirect.example.net/v1/charges" },
      }))
      .mockResolvedValueOnce(mockResponse())

    await callExternalService({
      credential: mkCred({
        authType: "api_key_header",
        authConfig: { headerName: "X-API-Key" },
        secret: "api-secret",
      }),
      method: "GET",
      path: "/v1/charges",
      headers: { "x-caller-secret": "do-not-forward" },
      fetcher,
    })

    expect(fetcher).toHaveBeenCalledTimes(2)
    const firstHeaders = fetcher.mock.calls[0][1].headers as Record<string, string>
    const redirectedHeaders = fetcher.mock.calls[1][1].headers as Record<string, string>
    expect(firstHeaders["x-api-key"]).toBe("api-secret")
    expect(firstHeaders["x-caller-secret"]).toBe("do-not-forward")
    expect(redirectedHeaders).not.toHaveProperty("x-api-key")
    expect(redirectedHeaders).not.toHaveProperty("x-caller-secret")
  })

  it("decodes application/json response body as parsed JSON", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      mockResponse({ body: '{"k":42}' })
    )
    const r = await callExternalService({
      credential: mkCred(),
      method: "GET",
      path: "/",
      fetcher,
    })
    expect(r.body).toEqual({ k: 42 })
  })

  it("decodes text/* response as string", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      mockResponse({ body: "hello world", headers: { "content-type": "text/plain" } })
    )
    const r = await callExternalService({
      credential: mkCred(),
      method: "GET",
      path: "/",
      fetcher,
    })
    expect(r.body).toBe("hello world")
  })

  it("non-text non-JSON content type → body is null", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      mockResponse({ body: "binary stuff", headers: { "content-type": "application/octet-stream" } })
    )
    const r = await callExternalService({
      credential: mkCred(),
      method: "GET",
      path: "/",
      fetcher,
    })
    expect(r.body).toBeNull()
  })

  it("rejects non-https baseUrl", async () => {
    await expect(
      callExternalService({
        credential: mkCred({ baseUrl: "http://insecure.example.com" }),
        method: "GET",
        path: "/",
        fetcher: vi.fn(),
      })
    ).rejects.toMatchObject({
      name: "ExternalServiceError",
      kind: "invalid_base_url",
    })
  })

  it("rejects absolute URL in `path` (must be relative)", async () => {
    await expect(
      callExternalService({
        credential: mkCred(),
        method: "GET",
        path: "https://attacker.example.com/leak",
        fetcher: vi.fn(),
      })
    ).rejects.toMatchObject({ kind: "invalid_path" })
  })

  it("rejects a scheme-relative path that would switch credential origin", async () => {
    await expect(
      callExternalService({
        credential: mkCred({ baseUrl: "https://api.example.com/v1" }),
        method: "GET",
        path: "///attacker.example/leak",
        fetcher: vi.fn(),
      }),
    ).rejects.toMatchObject({ kind: "invalid_path" })
  })

  it("rejects backslash authority/path forms", async () => {
    await expect(
      callExternalService({
        credential: mkCred({ baseUrl: "https://api.example.com/v1" }),
        method: "GET",
        path: "/\\\\attacker.example/leak",
        fetcher: vi.fn(),
      }),
    ).rejects.toMatchObject({ kind: "invalid_path" })
  })

  it("rejects encoded dot segments that escape the credential base path", async () => {
    await expect(
      callExternalService({
        credential: mkCred({ baseUrl: "https://api.example.com/v1" }),
        method: "GET",
        path: "%2e%2e/admin",
        fetcher: vi.fn(),
      }),
    ).rejects.toMatchObject({ kind: "invalid_path" })
  })

  it("rejects baseUrl with embedded credentials (SSRF + secret leak guard)", async () => {
    await expect(
      callExternalService({
        credential: mkCred({ baseUrl: "https://user:pass@api.example.com" }),
        method: "GET",
        path: "/",
        fetcher: vi.fn(),
      })
    ).rejects.toMatchObject({
      kind: "invalid_base_url",
      message: expect.stringMatching(/embedded credentials/i),
    })
  })

  it("rejects baseUrl pointing at IMDS / link-local (169.254.169.254)", async () => {
    await expect(
      callExternalService({
        credential: mkCred({ baseUrl: "https://169.254.169.254/latest/meta-data" }),
        method: "GET",
        path: "/",
        fetcher: vi.fn(),
      })
    ).rejects.toMatchObject({ kind: "invalid_base_url" })
  })

  it("rejects baseUrl pointing at loopback (127.0.0.1 / localhost / ::1)", async () => {
    for (const host of ["127.0.0.1", "localhost", "[::1]"]) {
      await expect(
        callExternalService({
          credential: mkCred({ baseUrl: `https://${host}` }),
          method: "GET",
          path: "/",
          fetcher: vi.fn(),
        })
      ).rejects.toMatchObject({ kind: "invalid_base_url" })
    }
  })

  it("rejects baseUrl in RFC1918 private ranges (10.x / 172.16-31.x / 192.168.x)", async () => {
    for (const host of ["10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1"]) {
      await expect(
        callExternalService({
          credential: mkCred({ baseUrl: `https://${host}` }),
          method: "GET",
          path: "/",
          fetcher: vi.fn(),
        })
      ).rejects.toMatchObject({ kind: "invalid_base_url" })
    }
  })

  it("rejects IPv4-mapped IPv6 that targets loopback / IMDS (SSRF bypass guard)", async () => {
    // ::ffff:127.0.0.1 → IPv4 loopback wrapped in IPv6. Earlier impl
    // routed only through isBlockedIPv4, missing the mapped form.
    for (const host of [
      "[::ffff:127.0.0.1]",
      "[::ffff:7f00:1]",        // same address in hex form
      "[::ffff:169.254.169.254]", // IMDS via IPv4-mapped
    ]) {
      await expect(
        callExternalService({
          credential: mkCred({ baseUrl: `https://${host}` }),
          method: "GET",
          path: "/",
          fetcher: vi.fn(),
        })
      ).rejects.toMatchObject({ kind: "invalid_base_url" })
    }
  })

  it("rejects fe80–febf link-local + fec0-feff site-local IPv6", async () => {
    // Earlier impl matched only fe80::; fe81-febf are equally link-local.
    // fec0-feff is RFC 4291-deprecated site-local but some stacks still
    // route it — block for parity with RFC1918 / link-local.
    for (const host of [
      "[fe80::1]", "[fe90::1]", "[febf::1]", // link-local /10
      "[fec0::1]", "[fed0::1]", "[feff::1]", // site-local /10 (deprecated)
    ]) {
      await expect(
        callExternalService({
          credential: mkCred({ baseUrl: `https://${host}` }),
          method: "GET",
          path: "/",
          fetcher: vi.fn(),
        })
      ).rejects.toMatchObject({ kind: "invalid_base_url" })
    }
  })

  it("rejects 64:ff9b::/96 NAT64 well-known prefix", async () => {
    // Per RFC 6052 — NAT64 wraps an IPv4 address that the host
    // network may route to internal IPs. Block for the same reason
    // as ::ffff:.
    await expect(
      callExternalService({
        credential: mkCred({ baseUrl: "https://[64:ff9b::1]" }),
        method: "GET",
        path: "/",
        fetcher: vi.fn(),
      })
    ).rejects.toMatchObject({ kind: "invalid_base_url" })
  })

  it("allows 169.253.x and 169.255.x (just outside link-local) — boundary correctness", async () => {
    const fetcher = vi.fn().mockImplementation(async () => mockResponse())
    await callExternalService({
      credential: mkCred({ baseUrl: "https://169.253.0.1" }),
      method: "GET",
      path: "/",
      fetcher,
    })
    fetcher.mockClear()
    await callExternalService({
      credential: mkCred({ baseUrl: "https://169.255.0.1" }),
      method: "GET",
      path: "/",
      fetcher,
    })
    expect(fetcher).toHaveBeenCalled()
  })

  it("allows 172.32.x and 172.15.x (just outside RFC1918) — boundary correctness", async () => {
    // These IPs are public-routable; the engine must not over-block.
    // Fresh Response per call so the body can be read twice.
    const fetcher = vi.fn().mockImplementation(async () => mockResponse())
    await callExternalService({
      credential: mkCred({ baseUrl: "https://172.32.0.1" }),
      method: "GET",
      path: "/",
      fetcher,
    })
    fetcher.mockClear()
    await callExternalService({
      credential: mkCred({ baseUrl: "https://172.15.0.1" }),
      method: "GET",
      path: "/",
      fetcher,
    })
    expect(fetcher).toHaveBeenCalled()
  })

  it("rejects path with .. segments (path-traversal guard)", async () => {
    await expect(
      callExternalService({
        credential: mkCred(),
        method: "GET",
        path: "/v1/../../secrets",
        fetcher: vi.fn(),
      })
    ).rejects.toMatchObject({ kind: "invalid_path" })
  })

  it("serialises jsonBody + sets content-type when caller hasn't", async () => {
    const fetcher = vi.fn().mockResolvedValue(mockResponse())
    await callExternalService({
      credential: mkCred(),
      method: "POST",
      path: "/v1/charges",
      jsonBody: { amount: 100 },
      fetcher,
    })
    const init = fetcher.mock.calls[0][1] as RequestInit & {
      headers: Record<string, string>
    }
    expect(init.body).toBe('{"amount":100}')
    expect(init.headers["content-type"]).toBe("application/json")
  })

  it("rejects non-JSON-serialisable jsonBody (BigInt)", async () => {
    await expect(
      callExternalService({
        credential: mkCred(),
        method: "POST",
        path: "/",
        // BigInt literal (42n) would need ES2020 target — use the
        // constructor form so it works under the project's TS config.
        jsonBody: BigInt(42),
        fetcher: vi.fn(),
      })
    ).rejects.toMatchObject({ kind: "decode_failed" })
  })

  it("wraps fetch failure in ExternalServiceError(fetch_failed)", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"))
    await expect(
      callExternalService({
        credential: mkCred(),
        method: "GET",
        path: "/",
        fetcher,
      })
    ).rejects.toMatchObject({ kind: "fetch_failed" })
  })

  it("maps abort signal to ExternalServiceError(timeout)", async () => {
    const fetcher: typeof fetch = (_url, init) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new Error("aborted"))
        })
      })
    await expect(
      callExternalService({
        credential: mkCred(),
        method: "GET",
        path: "/",
        timeoutMs: 50,
        fetcher,
      })
    ).rejects.toMatchObject({ kind: "timeout" })
  })

  it("lowercases response headers + reports durationMs", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      mockResponse({ headers: { "Content-Type": "application/json", "X-RateLimit-Remaining": "99" }, body: "{}" })
    )
    const r = await callExternalService({
      credential: mkCred(),
      method: "GET",
      path: "/",
      fetcher,
    })
    expect(r.headers["content-type"]).toBe("application/json")
    expect(r.headers["x-ratelimit-remaining"]).toBe("99")
    expect(r.durationMs).toBeGreaterThanOrEqual(0)
  })

  it("joins baseUrl + path correctly when both have/lack trailing slashes", async () => {
    // Implementation creates a fresh Response per call so the body
    // can be read twice (re-using a single Response throws on the
    // second read).
    const fetcher = vi.fn().mockImplementation(async () => mockResponse())
    await callExternalService({
      credential: mkCred({ baseUrl: "https://api.example.com" }),
      method: "GET",
      path: "v1/foo",
      fetcher,
    })
    expect(fetcher.mock.calls[0][0]).toBe("https://api.example.com/v1/foo")

    fetcher.mockClear()
    await callExternalService({
      credential: mkCred({ baseUrl: "https://api.example.com/" }),
      method: "GET",
      path: "/v1/foo",
      fetcher,
    })
    expect(fetcher.mock.calls[0][0]).toBe("https://api.example.com/v1/foo")
  })
})
