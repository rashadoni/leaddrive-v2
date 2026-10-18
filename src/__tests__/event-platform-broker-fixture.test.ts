import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { KafkaEventRecord } from "../lib/event-platform/consumer"
import { createBrokerFixtureHarness } from "../../scripts/event-platform/fixtures/kafka-broker-harness"

// Mock-only command/encoding contract. No Docker/Java process, network, real
// configuration file or broker behavior is exercised by this test suite.
const mocks = vi.hoisted(() => ({
  spawnSync: vi.fn(), spawn: vi.fn(), mkdtemp: vi.fn(), mkdir: vi.fn(), writeFile: vi.fn(),
  offsets: ["9007199254740993", "9007199254740995"],
}))
vi.mock("node:child_process", () => ({ spawnSync: mocks.spawnSync, spawn: mocks.spawn }))
vi.mock("node:fs", () => ({ mkdtempSync: mocks.mkdtemp, mkdirSync: mocks.mkdir, writeFileSync: mocks.writeFile }))

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv("GITHUB_ACTIONS", "true")
  vi.stubEnv("LD_EVENT_STACK_DISPOSABLE", "1")
  vi.stubEnv("LD_EVENT_STACK_PROJECT", "ld-event-test-unit-fixture")
  mocks.mkdtemp.mockReturnValue("/tmp/leaddrive-broker-fixture-unit-only")
  mocks.offsets = ["9007199254740993", "9007199254740995"]
  mocks.spawnSync.mockImplementation((_binary: string, args: string[]) => {
    const entry = args.indexOf("KafkaBridgeFixture")
    const action = args[entry + 1]
    const stdout = entry < 0 ? "" : action === "create" ? "synthetic-cluster\tsynthetic-topic-id\n"
      : action === "produce" ? mocks.offsets.join("\n") + "\n" : action === "seed" ? "SEEDED\n" : "9007199254740993\n"
    return { status: 0, stdout, stderr: "" }
  })
})
afterEach(() => {
  // These tests never even invoke the mocked long-running worker launcher.
  expect(mocks.spawn).not.toHaveBeenCalled()
  vi.unstubAllEnvs()
})

function records(): KafkaEventRecord[] {
  return [0, 1].map(index => ({ topic: "ld.testbroker.finance.events.v1", partition: 0, offset: String(10 + index),
    key: Buffer.from([0, 255, 128, 10, index]), value: ` {"synthetic":"Привет ${index}", "spacing":true} `,
    headers: { id: `synthetic-id-${index}`, eventtype: Buffer.from("finance.synthetic.v1"),
      organizationid: "synthetic-tenant-ä", payloadhash: "a".repeat(64) },
  }))
}
function fixtureCalls() { return mocks.spawnSync.mock.calls.filter(([, args]) => args.includes("KafkaBridgeFixture")) }

describe("broker fixture admission without subprocesses", () => {
  it.each([
    ["GITHUB_ACTIONS", undefined], ["GITHUB_ACTIONS", "false"],
    ["LD_EVENT_STACK_DISPOSABLE", undefined], ["LD_EVENT_STACK_DISPOSABLE", "0"],
    ["LD_EVENT_STACK_PROJECT", undefined], ["LD_EVENT_STACK_PROJECT", "production"],
    ["LD_EVENT_STACK_PROJECT", "ld-event-test-../escape"], ["LD_EVENT_STACK_PROJECT", `ld-event-test-${"x".repeat(42)}`],
  ])("rejects invalid %s before any filesystem/process operation", (name, value) => {
    vi.stubEnv(name!, value)
    expect(() => createBrokerFixtureHarness()).toThrow()
    expect(mocks.spawnSync).not.toHaveBeenCalled()
    expect(mocks.mkdtemp).not.toHaveBeenCalled()
    expect(mocks.mkdir).not.toHaveBeenCalled()
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it("bounds create, produce, admitGroup and direct fixture JVMs inside the container before the host deadline", () => {
    const harness = createBrokerFixtureHarness()
    harness.create("finance", "empty")
    harness.produce("finance", records())
    harness.admitGroup("scenario", "finance", "9007199254740993")
    expect(harness.fixture("offset", "scenario", undefined, 10_000)).toBe("9007199254740993")
    const calls = fixtureCalls()
    expect(calls.map(([, args]) => args[args.indexOf("KafkaBridgeFixture") + 1])).toEqual(["create", "produce", "seed", "offset"])
    for (const [binary, args, config] of calls) {
      expect(binary).toBe("docker")
      const timeoutIndex = args.indexOf("timeout"), javaIndex = args.indexOf("java")
      expect(args.slice(timeoutIndex, javaIndex)).toEqual(["timeout", "-k", "1", `${(config.timeout - 3000) / 1000}s`])
      expect(Number(args[timeoutIndex + 3].slice(0, -1)) * 1000 + 1000).toBeLessThan(config.timeout)
      expect(config.maxBuffer).toBe(1024 * 1024)
      expect(args).toContain("LD_EVENT_STACK_DISPOSABLE=1")
      expect(args).toContain("GITHUB_ACTIONS=true")
      expect(args).toContain("ld-event-test-unit-fixture")
    }
    const seedArgs = calls[2][1]
    expect(seedArgs.slice(seedArgs.indexOf("KafkaBridgeFixture"))).toEqual([
      "KafkaBridgeFixture", "seed", "ld.testbroker.finance.events.v1", "ld-testbroker-scenario", "9007199254740993",
    ])
    for (const [, , mode] of mocks.writeFile.mock.calls) expect(mode).toEqual({ mode: 0o600 })
  })

  it.each([0, 1, 3999, -1, 4000.5, 60_001, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid deadline %s before spawning its command", budget => {
    const harness = createBrokerFixtureHarness(), before = mocks.spawnSync.mock.calls.length
    expect(() => harness.fixture("offset", "synthetic", undefined, budget)).toThrow("fixture command deadline too small or unbounded")
    expect(mocks.spawnSync).toHaveBeenCalledTimes(before)
  })

  it("preserves exact six-field base64 bytes and actual sparse decimal offsets beyond Number precision", () => {
    const harness = createBrokerFixtureHarness(), source = records()
    harness.create("finance", "empty")
    const published = harness.produce("finance", source)
    expect(published.map(record => record.offset)).toEqual(["9007199254740993", "9007199254740995"])
    expect(source.map(record => record.offset)).toEqual(["10", "11"])
    const [, , config] = fixtureCalls().find(([, args]) => args.includes("produce"))!
    const expectedLines = source.map(record => [record.key, record.value, record.headers!.id,
      record.headers!.eventtype, record.headers!.organizationid, record.headers!.payloadhash]
      .map(value => Buffer.from(value as string | Buffer).toString("base64")).join("\t"))
    expect(config.input).toBe(expectedLines.join("\n") + "\n")
    expect(config.input.trimEnd().split("\n").every((line: string) => line.split("\t").length === 6)).toBe(true)
    published.forEach((record, index) => {
      expect(record).not.toBe(source[index])
      expect(record.key).toBe(source[index].key)
      expect(record.value).toBe(source[index].value)
      expect(record.headers).toBe(source[index].headers)
    })
  })

  it.each([
    ["1"], ["1", "1"], ["2", "1"], ["01", "2"], ["-1", "2"], ["1.5", "2"], ["1e3", "2000"],
  ])("rejects malformed, missing or nonincreasing output offsets: %j", (...offsets) => {
    const harness = createBrokerFixtureHarness()
    harness.create("finance", "empty")
    mocks.offsets = offsets
    expect(() => harness.produce("finance", records())).toThrow()
  })

  it("rejects topic, partition, duplicate header array and oversized field before produce", () => {
    const harness = createBrokerFixtureHarness()
    harness.create("finance", "empty")
    const record = records()[0]
    for (const invalid of [
      { ...record, topic: "ld.production.finance.events.v1" }, { ...record, partition: 1 },
      { ...record, headers: { ...record.headers, id: ["one", "two"] } },
      { ...record, value: Buffer.alloc(1_048_577) }, { ...record, key: null },
    ]) {
      const before = mocks.spawnSync.mock.calls.length
      expect(() => harness.produce("finance", [invalid])).toThrow()
      expect(mocks.spawnSync).toHaveBeenCalledTimes(before)
    }
  })

  it("sanitizes failed and timed-out process diagnostics instead of exposing connection arguments or payloads", () => {
    const harness = createBrokerFixtureHarness(), sensitive = "synthetic-private-payload-and-connection"
    for (const status of [1, null]) {
      mocks.spawnSync.mockReturnValueOnce({ status, stdout: sensitive, stderr: sensitive, error: new Error(sensitive) })
      let observed: unknown
      try { harness.fixture("offset", "synthetic") } catch (error) { observed = error }
      expect(observed).toBeInstanceOf(Error)
      expect((observed as Error).message).toContain("synthetic broker command failed")
      expect((observed as Error).message).not.toContain(sensitive)
    }
  })
})
