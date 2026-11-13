import { afterEach, describe, expect, it, vi } from "vitest"

const loaded = vi.hoisted(() => ({ server: 0, edge: 0 }))
vi.mock("@sentry/nextjs", () => ({ captureRequestError: vi.fn() }))
vi.mock("../../sentry.server.config", () => { loaded.server += 1; return {} })
vi.mock("../../sentry.edge.config", () => { loaded.edge += 1; return {} })
vi.mock("@/lib/server-shutdown-deadline", () => ({ installServerShutdownDeadline: vi.fn() }))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  loaded.server = 0
  loaded.edge = 0
})

async function start(runtime: "nodejs" | "edge", dsn: string | undefined) {
  vi.stubEnv("NEXT_RUNTIME", runtime)
  if (dsn === undefined) {
    vi.stubEnv("SENTRY_DSN", "")
    delete process.env.SENTRY_DSN
  } else vi.stubEnv("SENTRY_DSN", dsn)
  const { register } = await import("@/instrumentation")
  await register()
}

/**
 * Sentry without a DSN sends nothing and still traces every request. Production runs without
 * one, so the SDK is loaded only where it has a destination (src/instrumentation.ts).
 */
describe("Sentry starts only where it can report", () => {
  it("is not loaded into a server that has no DSN", async () => {
    await start("nodejs", undefined)
    expect(loaded.server).toBe(0)
  })

  it("is not loaded for a blank DSN either", async () => {
    await start("nodejs", "   ")
    expect(loaded.server).toBe(0)
  })

  it("is loaded as before once a DSN is configured", async () => {
    await start("nodejs", "https://key@o1.ingest.sentry.io/1")
    expect(loaded.server).toBe(1)
    expect(loaded.edge).toBe(0)
  })

  it("follows the same rule on the edge runtime", async () => {
    await start("edge", undefined)
    expect(loaded.edge).toBe(0)
    vi.resetModules()
    await start("edge", "https://key@o1.ingest.sentry.io/1")
    expect(loaded.edge).toBe(1)
    expect(loaded.server).toBe(0)
  })

  it("still hands request errors to the SDK, which drops them without a client", async () => {
    const instrumentation = await import("@/instrumentation")
    expect(typeof instrumentation.onRequestError).toBe("function")
  })
})
