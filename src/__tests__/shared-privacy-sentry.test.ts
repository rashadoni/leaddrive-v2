import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"
import { NodeClient, defaultStackParser } from "@sentry/node"
import { serializeEnvelope, type Envelope, type Event, type Integration } from "@sentry/core"
import { minimizeSentryEvent, privateSentryOptions, privateSentryIntegrations } from "@/lib/telemetry/sentry-privacy"

const CANARY = "PRIVATE_SYNTHETIC_person@example.invalid_Bearer_secret"
const trace = { trace_id: "a".repeat(32), span_id: "b".repeat(16), op: "http.server", status: "ok", data: { url: CANARY } }
function unsafeEvent(): Event {
  return { message: CANARY, logentry: { message: CANARY }, user: { email: CANARY }, request: { url: CANARY, data: CANARY, headers: { authorization: CANARY } }, extra: { token: CANARY }, tags: { tenant: CANARY }, breadcrumbs: [{ message: CANARY }], contexts: { trace, arbitrary: { secret: CANARY } }, exception: { values: [{ type: "TypeError", value: CANARY, stacktrace: { frames: [{ filename: `/src/workforce/${CANARY}.ts`, function: CANARY, context_line: CANARY, vars: { secret: CANARY }, lineno: 17, in_app: true }] } }] } }
}
function client(extraIntegrations: Integration[] = []) {
  const wires: string[] = []
  const sdk = new NodeClient({ dsn: "https://synthetic@example.invalid/1", stackParser: defaultStackParser, tracesSampleRate: 1, ...privateSentryOptions, integrations: privateSentryIntegrations(extraIntegrations), transport: () => ({ send(envelope) { const wire = serializeEnvelope(envelope); wires.push(typeof wire === "string" ? wire : new TextDecoder().decode(wire)); return Promise.resolve({ statusCode: 200 }) }, flush: () => Promise.resolve(true) }) })
  sdk.init()
  return { sdk, wires }
}

describe("shared Sentry existing transport privacy boundary", () => {
  it("blocks hidden-document init sessions and retains the BrowserClient no-IP-inference directive", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "shared-privacy-browser-"))
    try {
      for (const name of ["safe-fields", "sentry-privacy"]) {
        const source = readFileSync(path.join(process.cwd(), "src/lib/telemetry", `${name}.ts`), "utf8")
        writeFileSync(path.join(directory, `${name}.js`), ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)
      }
      const script = `
        global.document = { visibilityState: "hidden", addEventListener() {}, removeEventListener() {} };
        global.addEventListener = () => {}; global.removeEventListener = () => {};
        const browser = require(require.resolve("@sentry/browser", { paths: [process.cwd()] }));
        const core = require(require.resolve("@sentry/core", { paths: [process.cwd()] }));
        const policy = require(process.argv[1]);
        const wires = []; let returned = false; const early = [];
        const client = browser.init({ dsn: "https://synthetic@example.invalid/1", release: "a".repeat(40), environment: "test", defaultIntegrations: [browser.browserSessionIntegration()], ...policy.privateSentryOptions,
          transport: () => ({ send: async envelope => { early.push(!returned); wires.push(core.serializeEnvelope(envelope)); return { statusCode: 200 } }, flush: async () => true }) });
        returned = true;
        client.captureEvent({ message: "PRIVATE_SYNTHETIC_BROWSER", user: { ip_address: "192.0.2.1" }, sdk: { settings: { infer_ip: "auto" } } });
        client.flush(2000).then(() => { console.log(JSON.stringify({ wires, early, integrations: client.getIntegrationNames() })); return client.close() });
      `
      const result = JSON.parse(execFileSync(process.execPath, ["-e", script, path.join(directory, "sentry-privacy.js")], { cwd: process.cwd(), encoding: "utf8", timeout: 10_000 }))
      expect(result.early).toEqual([false])
      expect(result.integrations).toContain("ApplicationPrivacyBoundary")
      expect(result.integrations).not.toContain("BrowserSession")
      expect(result.wires).toHaveLength(1)
      expect(result.wires[0]).not.toContain("PRIVATE_SYNTHETIC_BROWSER")
      expect(result.wires[0]).not.toContain("192.0.2.1")
      expect(result.wires[0]).toContain('"infer_ip":"never"')
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it("filters a real SDK envelope emitted synchronously during integration setup", async () => {
    const { sdk, wires } = client([{
      name: "SyntheticInitEmitter",
      beforeSetup(sdk) { void sdk.sendEnvelope([{}, [[{ type: "event" }, unsafeEvent()], [{ type: "session" }, { sid: CANARY }]]] as unknown as Envelope) },
    }])
    await sdk.flush(2000)
    expect(wires).toHaveLength(1)
    expect(wires[0]).not.toContain(CANARY)
    expect(wires[0]).not.toContain('"session"')
    expect(wires[0]).toContain('"message":"Application error"')
    await sdk.close()
  })

  it("runs real SDK event processing, attachment handling and final serialization", async () => {
    const { sdk, wires } = client()
    sdk.captureEvent(unsafeEvent(), { attachments: [{ filename: CANARY, data: CANARY }] })
    expect(await sdk.flush(2000)).toBe(true)
    expect(wires).toHaveLength(1)
    expect(wires.join("")).not.toContain(CANARY)
    expect(wires[0]).not.toContain('"attachment"')
    expect(wires[0]).toContain('"filename":"application:workforce"')
    expect(wires[0]).toContain('"type":"TypeError"')
    expect(wires[0]).toContain('"lineno":17')
    expect(wires[0]).toContain(trace.trace_id)
    await sdk.close()
  })

  it("retains transaction timing/correlation but drops URLs, descriptions and arbitrary span data", async () => {
    const { sdk, wires } = client()
    sdk.captureEvent({ ...unsafeEvent(), type: "transaction", transaction: CANARY, timestamp: 20, start_timestamp: 10, spans: [{ ...trace, timestamp: 19, start_timestamp: 11, description: CANARY, data: { secret: CANARY } }] })
    await sdk.flush(2000)
    expect(wires).toHaveLength(1)
    expect(wires[0]).not.toContain(CANARY)
    expect(wires[0]).toContain('"transaction":"application.transaction"')
    expect(wires[0]).toContain('"start_timestamp":11')
    await sdk.close()
  })

  it("filters envelope-only channels and metadata immediately before the SDK transport", async () => {
    const { sdk, wires } = client()
    const envelope = [{ event_id: "c".repeat(32), trace: { secret: CANARY }, sdk: { name: CANARY } }, [
      [{ type: "event", filename: CANARY }, unsafeEvent()],
      ...["attachment", "replay_event", "replay_recording", "session", "sessions", "log", "metric", "profile", "check_in", "span"].map(type => [{ type }, { secret: CANARY }]),
    ]] as unknown as Envelope
    await sdk.sendEnvelope(envelope)
    expect(wires).toHaveLength(1)
    expect(wires[0]).not.toContain(CANARY)
    expect(envelope[1]).toHaveLength(1)
    expect(envelope[0]).toEqual({ event_id: "c".repeat(32) })
    await sdk.close()
  })

  it("is idempotent and bounded without traversing getters, cycles or coercion", () => {
    const input = unsafeEvent()
    expect(minimizeSentryEvent(minimizeSentryEvent(input))).toEqual(minimizeSentryEvent(input))
    let touched = 0
    const hostile = { get value(): string { touched++; throw new Error(CANARY) }, toJSON() { touched++; throw new Error(CANARY) } }
    input.extra = { hostile, circular: input }
    input.exception = { values: [hostile] }
    expect(JSON.stringify(minimizeSentryEvent(input))).not.toContain(CANARY)
    expect(touched).toBe(0)
    const revoked = Proxy.revocable({}, {}); revoked.revoke()
    expect(() => minimizeSentryEvent(revoked.proxy)).not.toThrow()
  })
})
