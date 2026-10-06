import { describe, expect, it } from "vitest"
import { NodeClient, defaultStackParser } from "@sentry/node"
import { serializeEnvelope, type Envelope, type Event } from "@sentry/core"
import { minimizeSentryEnvelope, minimizeSentryEvent, privateSentryOptions } from "@/lib/telemetry/sentry-privacy"

const CANARY = "PRIVATE_SYNTHETIC_person@example.invalid_Bearer_secret"
const trace = { trace_id: "a".repeat(32), span_id: "b".repeat(16), op: "http.server", status: "ok", data: { url: CANARY } }
function unsafeEvent(): Event {
  return { message: CANARY, logentry: { message: CANARY }, user: { email: CANARY }, request: { url: CANARY, data: CANARY, headers: { authorization: CANARY } }, extra: { token: CANARY }, tags: { tenant: CANARY }, breadcrumbs: [{ message: CANARY }], contexts: { trace, arbitrary: { secret: CANARY } }, exception: { values: [{ type: "TypeError", value: CANARY, stacktrace: { frames: [{ filename: `/src/workforce/${CANARY}.ts`, function: CANARY, context_line: CANARY, vars: { secret: CANARY }, lineno: 17, in_app: true }] } }] } }
}
function client() {
  const wires: string[] = []
  const sdk = new NodeClient({ dsn: "https://synthetic@example.invalid/1", integrations: [], stackParser: defaultStackParser, tracesSampleRate: 1, ...privateSentryOptions, transport: () => ({ send(envelope) { const wire = serializeEnvelope(envelope); wires.push(typeof wire === "string" ? wire : new TextDecoder().decode(wire)); return Promise.resolve({ statusCode: 200 }) }, flush: () => Promise.resolve(true) }) })
  sdk.on("beforeEnvelope", minimizeSentryEnvelope)
  sdk.init()
  return { sdk, wires }
}

describe("shared Sentry existing transport privacy boundary", () => {
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
