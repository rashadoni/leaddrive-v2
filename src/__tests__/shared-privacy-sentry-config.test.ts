import { afterEach, describe, expect, it, vi } from "vitest"
import { minimizeSentryEnvelope, privateSentryOptions } from "@/lib/telemetry/sentry-privacy"
const mocks = vi.hoisted(() => ({ init: vi.fn(), on: vi.fn(), browserTracingIntegration: vi.fn(() => ({ name: "BrowserTracing" })), replayIntegration: vi.fn(), getReplay: vi.fn(), captureRouterTransitionStart: vi.fn() }))
vi.mock("@sentry/nextjs", () => mocks)
afterEach(() => vi.clearAllMocks())
describe("all configured Sentry runtimes share the destination boundary", () => {
  it.each(["server", "edge", "client"])("installs event, transaction and final envelope hooks for %s", async runtime => {
    mocks.init.mockReturnValue({ on: mocks.on })
    if (runtime === "server") await import("../../sentry.server.config")
    else if (runtime === "edge") await import("../../sentry.edge.config")
    else await import("../../instrumentation-client")
    expect(mocks.init).toHaveBeenCalledOnce()
    expect(mocks.init.mock.calls[0][0]).toMatchObject(privateSentryOptions)
    expect(mocks.on).toHaveBeenCalledWith("beforeEnvelope", minimizeSentryEnvelope)
    expect(mocks.replayIntegration).not.toHaveBeenCalled()
    if (runtime === "client") expect(mocks.init.mock.calls[0][0]).toMatchObject({ replaysSessionSampleRate: 0, replaysOnErrorSampleRate: 0 })
  })
})
