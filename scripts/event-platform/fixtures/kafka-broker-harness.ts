/** Runner-only broker fixture. Nothing here is a production launcher. */
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process"
import { copyFileSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { isAbsolute, resolve } from "node:path"
import { PassThrough, type Readable, type Writable } from "node:stream"
import { createKafkaBridgeChannel } from "../../../src/lib/event-platform/kafka-bridge"
import { verifyKafkaWorkerArtifact } from "../../../src/lib/event-platform/worker-artifact"
import { createSupervisedKafkaChannel } from "../../../src/lib/event-platform/worker-process"
import { validateKafkaWorkerPlan } from "../../../src/lib/event-platform/worker-admission"
import type { FundShadowScope } from "../../../src/lib/event-platform/fund-shadow-consumer"
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
  function admitGroup(name: string, source: string, start: string, groupId?: string) {
    nameGuard(name); assert.match(start, /^(0|[1-9][0-9]*)$/)
    const original = configurations.get(source); assert.ok(original)
    if (groupId) assert.match(groupId, /^ld\.testbroker\.finance\.fund-shadow\.v(?:[2-9]|[1-9][0-9]{1,9})\.[a-z][a-z0-9-]{0,62}$/)
    const config = { ...original, group: groupId ?? `ld-testbroker-${name}` }
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
  const directChildren = new Set<ReturnType<typeof createSupervisedKafkaChannel>>()
  let artifact: Promise<Awaited<ReturnType<typeof verifyKafkaWorkerArtifact>>> | undefined
  function verifiedArtifact() {
    if (!artifact) artifact = (async () => {
      // The compiled driver and dependencies come from this exact checkout and
      // digest-pinned disposable Kafka image. Fixture/admin classes stay out.
      const artifactRoot = resolve(temporary, "worker-artifact")
      mkdirSync(artifactRoot, { mode: 0o700 }); mkdirSync(resolve(artifactRoot, "classes"), { mode: 0o700 })
      mkdirSync(resolve(artifactRoot, "lib"), { mode: 0o700 })
      const files: Array<{ path: string; bytes: number; sha256: string }> = []
      const digest = (bytes: Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`
      function member(path: string, source: string) {
        copyFileSync(source, resolve(artifactRoot, path))
        const bytes = readFileSync(resolve(artifactRoot, path))
        files.push({ path, bytes: bytes.length, sha256: digest(bytes) })
      }
      for (const name of readdirSync(resolve(temporary, "classes")).sort()) {
        if (/^KafkaPartitionBridge(?:\$[A-Za-z0-9_]+)?\.class$/.test(name)) member(`classes/${name}`, resolve(temporary, "classes", name))
      }
      for (const name of readdirSync(resolve(temporary, "libs")).sort()) {
        // Client-only package: no broker/Connect/Streams tooling or RocksDB.
        if (!/^(?:kafka-clients|slf4j-api|log4j-api|log4j-core|log4j-slf4j2?-impl|zstd-jni|lz4-java|snappy-java)-[0-9][A-Za-z0-9_.-]*\.jar$/.test(name)) continue
        member(`lib/${name}`, resolve(temporary, "libs", name))
      }
      member("logging.properties", resolve(temporary, "logging.properties"))
      const releaseSha = execute("git", ["rev-parse", "HEAD"], 10_000); assert.match(releaseSha, /^[0-9a-f]{40}$/)
      const manifest = Buffer.from(JSON.stringify({ apiVersion: "event-platform.leaddrive.io/v1", kind: "KafkaBridgeArtifact",
        releaseSha, kafkaVersion: "4.3.1", files }))
      writeFileSync(resolve(artifactRoot, "manifest.json"), manifest, { mode: 0o600 })
      return verifyKafkaWorkerArtifact({ root: artifactRoot, expectedReleaseSha: releaseSha, expectedManifestSha256: digest(manifest) })
    })()
    return artifact
  }
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
    return { kind: "container" as const, child, channel: createBrokerFixtureChannel({ stdout: child.stdout, stdin: child.stdin, terminate: () => terminate(child), timeoutMs }) }
  }
  async function directDriver(name: string, scopes: readonly FundShadowScope[], maxRecords: number, timeoutMs = 35_000) {
    nameGuard(name); assert.ok(configurations.has(name))
    assert.ok(process.env.JAVA_HOME && resolve(process.env.JAVA_HOME).startsWith("/"), "controlled CI JDK required")
    const verified = await verifiedArtifact()
    const configured = configurations.get(name)!
    const plan = validateKafkaWorkerPlan({ apiVersion: "event-platform.leaddrive.io/v1", kind: "FundShadowWorkerPlan",
      releaseSha: verified.releaseSha, artifactSha256: verified.manifestSha256, environment: "testbroker",
      broker: { clusterId: configured.cluster, groupId: configured.group, topic: configured.topic, topicId: configured.topicId, partitionCount: 1 },
      limits: { maxRecords, maxDurationMs: 120_000 }, kafkaSecretReference: "vault://synthetic/kafka",
      routes: scopes.map(scope => ({ scope, databaseSecretReference: `vault://synthetic/workers/${scope.expectedWorkerRole}` })),
    }, { releaseSha: verified.releaseSha, artifactSha256: verified.manifestSha256, environment: "testbroker" })
    const id = execute("docker", [...compose, "ps", "-q", "kafka"], 10_000)
    assert.match(id, /^[a-f0-9]{12,64}$/)
    const networks = JSON.parse(execute("docker", ["inspect", "--format", "{{json .NetworkSettings.Networks}}", id], 10_000))
    const address = networks[`${project}_default`]?.IPAddress
    assert.equal(typeof address, "string")
    const octets = address.split(".").map(Number)
    assert.ok(octets.length === 4 && octets.every((n: number) => Number.isInteger(n) && n >= 0 && n <= 255)
      && (octets[0] === 10 || octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31 || octets[0] === 192 && octets[1] === 168))
    // JDK21's documented per-process test hosts file: no published Kafka port,
    // system DNS/hosts mutation, Docker shim or shell between Node and JVM.
    const hosts = resolve(temporary, `${name}.hosts`)
    writeFileSync(hosts, `127.0.0.1 localhost\n${address} kafka\n`, { mode: 0o600 })
    let child!: ChildProcessWithoutNullStreams
    const supervised = createSupervisedKafkaChannel({ stopGraceMs: 5000, killGraceMs: 1000, timeoutMs,
      spawn() {
        child = spawn(resolve(process.env.JAVA_HOME!, "bin/java"), ["-Xms16m", "-Xmx96m", "-XX:ActiveProcessorCount=1",
          "-XX:MaxDirectMemorySize=32m", "-XX:MaxMetaspaceSize=128m", "-XX:+ExitOnOutOfMemoryError",
          `-Djdk.net.hosts.file=${hosts}`, `-Dlog4j2.configurationFile=${verified.loggingConfiguration}`,
          "-cp", verified.classpath.join(":"), "KafkaPartitionBridge", resolve(temporary, `${name}.properties`)],
        { cwd: temporary, stdio: ["pipe", "pipe", "pipe"], env: { NODE_ENV: "test", LANG: "C.UTF-8",
          GITHUB_ACTIONS: "true", LD_EVENT_STACK_DISPOSABLE: "1" } })
        return child
      },
    })
    directChildren.add(supervised)
    return { kind: "direct" as const, child, channel: supervised.channel, exited: supervised.exited, plan }
  }
  async function exportArtifact() {
    // CI candidate only, never a production installation. Refuse replacement
    // of an existing package; all contents are reverified at the new path.
    const runnerTemporary = process.env.RUNNER_TEMP
    assert.ok(runnerTemporary && isAbsolute(runnerTemporary) && resolve(runnerTemporary) === runnerTemporary
      && runnerTemporary !== "/", "controlled runner temporary directory required")
    const verified = await verifiedArtifact()
    await verifyKafkaWorkerArtifact({ root: verified.root, expectedReleaseSha: verified.releaseSha,
      expectedManifestSha256: verified.manifestSha256 })
    const destination = resolve(runnerTemporary, "leaddrive-worker-artifact")
    mkdirSync(destination, { mode: 0o700 })
    mkdirSync(resolve(destination, "classes"), { mode: 0o700 })
    mkdirSync(resolve(destination, "lib"), { mode: 0o700 })
    const manifest = JSON.parse(readFileSync(resolve(verified.root, "manifest.json"), "utf8"))
    for (const file of manifest.files as Array<{ path: string }>) {
      copyFileSync(resolve(verified.root, file.path), resolve(destination, file.path))
    }
    copyFileSync(resolve(verified.root, "manifest.json"), resolve(destination, "manifest.json"))
    await verifyKafkaWorkerArtifact({ root: destination, expectedReleaseSha: verified.releaseSha,
      expectedManifestSha256: verified.manifestSha256 })
    console.log(`worker_candidate_release_sha=${verified.releaseSha}; manifest_sha256=${verified.manifestSha256}; production_installation=not-performed`)
  }
  async function close() {
    const results = await Promise.allSettled([...children].map(terminate).concat([...directChildren].map(async supervised => {
      try { await supervised.channel.close() } finally { await supervised.exited; directChildren.delete(supervised) }
    })))
    assert.ok(results.every(result => result.status === "fulfilled"), "fixture cleanup not confirmed")
  }
  return { create, fixture, admitGroup, produce, driver, directDriver, exportArtifact, configurations, close }
}
