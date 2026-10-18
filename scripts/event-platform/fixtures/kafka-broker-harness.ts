/** Runner-only broker fixture. Nothing here is a production launcher. */
import assert from "node:assert/strict"
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { PassThrough, type Readable, type Writable } from "node:stream"
import { createKafkaBridgeChannel } from "../../../src/lib/event-platform/kafka-bridge"
import type { KafkaEventRecord } from "../../../src/lib/event-platform/consumer"

/**
 * A bridge closes its private reader as soon as FAIL is observed. Keep the
 * subprocess's actual stdout open until it exits: Java's finally can emit
 * REVOKE, and closing Docker's pipe first would turn exit 1 into SIGPIPE.
 * Forwarding has bounded backpressure; after close, discard (never log) the
 * remaining bytes while the existing terminate callback reaps its own child.
 */
export function createBrokerFixtureChannel(input: {
  stdout: Readable; stdin: Writable; terminate: () => Promise<void>; timeoutMs?: number
}) {
  const privateOutput = new PassThrough({ highWaterMark: 64 * 1024 })
  input.stdout.on("error", () => { privateOutput.destroy() })
  privateOutput.once("close", () => {
    input.stdout.unpipe(privateOutput)
    input.stdout.resume()
  })
  input.stdout.pipe(privateOutput)
  return createKafkaBridgeChannel({ ...input, stdout: privateOutput })
}

export function createBrokerFixtureHarness() {
  const root = resolve(process.cwd())
  const project = process.env.LD_EVENT_STACK_PROJECT ?? ""
  assert.equal(process.env.GITHUB_ACTIONS, "true")
  assert.equal(process.env.LD_EVENT_STACK_DISPOSABLE, "1")
  assert.match(project, /^ld-event-test-[a-z0-9][a-z0-9-]{0,40}$/)
  const compose = ["compose", "-p", project, "-f", resolve(root, "ops/event-platform/test/compose.yml")]
  const temporary = mkdtempSync(resolve(tmpdir(), "leaddrive-broker-driver-"))
  function execute(binary: string, args: string[], timeout = 60_000, input?: string) {
    const result = spawnSync(binary, args, { cwd: root, input, encoding: "utf8", maxBuffer: 1024 * 1024, timeout })
    // Do not echo private payloads or command/connection arguments on failure.
    assert.equal(result.status, 0, "synthetic broker command failed")
    return result.stdout.trim()
  }
  const java = [...compose, "exec", "-T", "-u", "0", "-e", "GITHUB_ACTIONS=true", "-e", "LD_EVENT_STACK_DISPOSABLE=1", "kafka", "java",
    "-Xms16m", "-Xmx96m", "-XX:ActiveProcessorCount=1", "-Dlog4j2.configurationFile=/tmp/bridge-log4j2.properties", "-cp", "/opt/kafka/libs/*:/tmp/bridge-classes"]
  const configurations = new Map<string, { cluster: string; topicId: string; topic: string; group: string }>()
  const nameGuard = (name: string) => assert.match(name, /^[a-z0-9][a-z0-9-]{0,60}$/)
  function executeFixture(args: string[], timeout: number, input?: string) {
    assert.ok(Number.isSafeInteger(timeout) && timeout >= 4000 && timeout <= 60_000, "fixture command deadline too small or unbounded")
    const boundedJava = [...java]
    // Reap the actual JVM before the host Docker shim's longer deadline.
    // Producer.close() and client shutdown are bounded even after API failure.
    boundedJava.splice(boundedJava.indexOf("java"), 0, "timeout", "-k", "1", `${(timeout - 3000) / 1000}s`)
    return execute("docker", [...boundedJava, "KafkaBridgeFixture", ...args], timeout, input)
  }
  function fixture(action: string, name: string, mode?: string, timeout = 60_000, input?: string) {
    nameGuard(name)
    const config = configurations.get(name)
    return executeFixture([action, config?.topic ?? `ld.testbroker.${name}.events.v1`,
      config?.group ?? `ld-testbroker-${name}`, ...(mode ? [mode] : [])], timeout, input)
  }
  mkdirSync(resolve(temporary, "classes"))
  execute("docker", [...compose, "cp", "kafka:/opt/kafka/libs", resolve(temporary, "libs")])
  execute("javac", ["-J-Xmx128m", "-cp", resolve(temporary, "libs/*"), "-d", resolve(temporary, "classes"),
    "ops/event-platform/driver/KafkaPartitionBridge.java", "ops/event-platform/test/KafkaBridgeFixture.java"])
  execute("docker", [...compose, "cp", resolve(temporary, "classes"), "kafka:/tmp/bridge-classes"])
  writeFileSync(resolve(temporary, "logging.properties"), "status=OFF\nrootLogger.level=OFF\n", { mode: 0o600 })
  execute("docker", [...compose, "cp", resolve(temporary, "logging.properties"), "kafka:/tmp/bridge-log4j2.properties"])
  function configure(name: string, config: { cluster: string; topicId: string; topic: string; group: string }) {
    nameGuard(name)
    assert.ok(!configurations.has(name), "a fixture group cannot be reinitialized")
    configurations.set(name, config)
    const path = resolve(temporary, `${name}.properties`)
    writeFileSync(path, `expected.cluster.id=${config.cluster}\nexpected.topic.id=${config.topicId}\nexpected.partitions=1\nbootstrap.servers=kafka:9092\nsecurity.protocol=PLAINTEXT\ntest.profile=disposable-ci\ngroup.id=${config.group}\ntopic=${config.topic}\n`, { mode: 0o600 })
    execute("docker", [...compose, "cp", path, `kafka:/tmp/bridge-${name}.properties`])
  }
  function create(name: string, mode = "plain") {
    nameGuard(name)
    const [cluster, topicId] = fixture("create", name, mode).split("\t")
    assert.ok(cluster && topicId)
    configure(name, { cluster, topicId, topic: `ld.testbroker.${name}.events.v1`, group: `ld-testbroker-${name}` })
  }
  function admitGroup(name: string, source: string, start: string) {
    nameGuard(name); assert.match(start, /^(0|[1-9][0-9]*)$/)
    const original = configurations.get(source); assert.ok(original)
    const config = { ...original, group: `ld-testbroker-${name}` }
    executeFixture(["seed", config.topic, config.group, start], 60_000)
    configure(name, config)
  }
  function produce(name: string, records: readonly KafkaEventRecord[]): KafkaEventRecord[] {
    const config = configurations.get(name); assert.ok(config)
    assert.ok(records.length > 0 && records.length <= 128)
    function bytes(value: unknown) {
      assert.ok(typeof value === "string" || Buffer.isBuffer(value))
      const buffer = Buffer.from(value); assert.ok(buffer.length > 0 && buffer.length <= 1_048_576)
      return buffer.toString("base64")
    }
    const input = records.map(record => {
      assert.equal(record.topic, config.topic); assert.equal(record.partition, 0)
      return [record.key, record.value, ...["id", "eventtype", "organizationid", "payloadhash"].map(header => record.headers?.[header])]
        .map(bytes).join("\t")
    }).join("\n") + "\n"
    assert.ok(Buffer.byteLength(input) <= 8 * 1024 * 1024)
    const offsets = fixture("produce", name, undefined, 60_000, input).split("\n")
    assert.equal(offsets.length, records.length)
    return records.map((record, index) => {
      assert.match(offsets[index], /^(0|[1-9][0-9]*)$/)
      if (index) assert.ok(BigInt(offsets[index]) > BigInt(offsets[index - 1]))
      return { ...record, offset: offsets[index] }
    })
  }
  const children = new Set<ChildProcessWithoutNullStreams>()
  async function terminate(child: ChildProcessWithoutNullStreams) {
    if (child.exitCode !== null || child.signalCode !== null) { children.delete(child); return }
    child.stdin.end()
    await new Promise<void>((resolve, reject) => {
      // Docker shim exit alone is not child reaping: await the in-container timeout.
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("fixture exit not confirmed")) }, 100_000)
      child.once("exit", () => { clearTimeout(timer); resolve() })
      child.once("error", () => { clearTimeout(timer); reject(new Error("fixture spawn failed")) })
    })
    children.delete(child)
  }
  function driver(name: string, timeoutMs = 35_000) {
    nameGuard(name); assert.ok(configurations.has(name))
    const timeoutJava = [...java]
    timeoutJava.splice(timeoutJava.indexOf("java"), 0, "timeout", "-k", "5", "90")
    const child = spawn("docker", [...timeoutJava, "KafkaPartitionBridge", `/tmp/bridge-${name}.properties`], { cwd: root, stdio: ["pipe", "pipe", "pipe"] })
    children.add(child)
    child.on("error", () => { child.stdout.destroy(); child.stdin.destroy() })
    child.stderr.resume()
    return { child, channel: createBrokerFixtureChannel({ stdout: child.stdout, stdin: child.stdin, terminate: () => terminate(child), timeoutMs }) }
  }
  return { create, fixture, admitGroup, produce, driver, configurations, close: () => Promise.all([...children].map(terminate)) }
}
