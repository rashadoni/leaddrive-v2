import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@sentry/nextjs", () => ({ captureRequestError: vi.fn() }))
vi.mock("../../sentry.server.config", () => ({}))
vi.mock("../../sentry.edge.config", () => ({}))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe("server start-up and the bundled WebSocket library", () => {
  it("tells ws not to look for its native helper before any route can load it", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs")
    vi.stubEnv("WS_NO_BUFFER_UTIL", undefined as unknown as string)
    delete process.env.WS_NO_BUFFER_UTIL
    const { register } = await import("@/instrumentation")
    await register()
    expect(process.env.WS_NO_BUFFER_UTIL).toBe("1")
  })

  it("leaves an operator's own choice alone", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs")
    vi.stubEnv("WS_NO_BUFFER_UTIL", "operator")
    const { register } = await import("@/instrumentation")
    await register()
    expect(process.env.WS_NO_BUFFER_UTIL).toBe("operator")
  })

  it("sets it before anything else in the hook is awaited", () => {
    // Order is the whole fix: a variable set after the first import that could
    // pull the SDK in would be read too late.
    const source = readFileSync("src/instrumentation.ts", "utf8")
    expect(source.indexOf("WS_NO_BUFFER_UTIL ??=")).toBeGreaterThan(-1)
    expect(source.indexOf("WS_NO_BUFFER_UTIL ??=")).toBeLessThan(source.indexOf("await import("))
  })

  /**
   * ws's own masking module, loaded the way the production bundle loads it:
   * with `require("bufferutil")` answering an empty module instead of throwing.
   */
  function loadBufferUtil(env: Record<string, string | undefined>) {
    const require = createRequire(import.meta.url)
    const lib = join(dirname(require.resolve("ws/package.json")), "lib")
    const source = readFileSync(join(lib, "buffer-util.js"), "utf8")
    const fromLib = createRequire(join(lib, "buffer-util.js"))
    const bundled = (id: string) => (id === "bufferutil" ? {} : fromLib(id))
    const loaded = { exports: {} as { mask: (...args: unknown[]) => void } }
    new Function("require", "module", "exports", "process", source)(bundled, loaded, loaded.exports, { env })
    return loaded.exports
  }

  function maskFrame(bufferUtil: ReturnType<typeof loadBufferUtil>) {
    // A Live setup message is kilobytes; 48 bytes is where ws hands over to
    // the native helper.
    const payload = Buffer.alloc(64, 0x41)
    const output = Buffer.alloc(64)
    bufferUtil.mask(payload, Buffer.from([1, 2, 3, 4]), output, 0, payload.length)
    return output
  }

  it("reproduces the production failure without the setting", () => {
    expect(() => maskFrame(loadBufferUtil({}))).toThrow(/mask is not a function/)
  })

  it("masks frames in JavaScript with the setting, as ws does without the helper", () => {
    const output = maskFrame(loadBufferUtil({ WS_NO_BUFFER_UTIL: "1" }))
    expect([...output.subarray(0, 4)]).toEqual([0x41 ^ 1, 0x41 ^ 2, 0x41 ^ 3, 0x41 ^ 4])
    expect(output.equals(Buffer.alloc(64, 0x41))).toBe(false)
  })
})
