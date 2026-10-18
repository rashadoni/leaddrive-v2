import { afterEach, describe, expect, it } from "vitest"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { constants } from "node:fs"
import { chmod, link, mkdir, mkdtemp, open, readFile, rename, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { KafkaWorkerArtifactError, verifyKafkaWorkerArtifact } from "../lib/event-platform/worker-artifact"

const SHA = "a".repeat(40)
const hash = (bytes: Buffer | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`
const roots: string[] = []
const fifos: string[] = []
afterEach(async () => {
  // Release a blocked old implementation if this regression ever returns.
  for (const path of fifos.splice(0)) await open(path, constants.O_WRONLY | constants.O_NONBLOCK).then(file => file.close()).catch(() => {})
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ld-worker-artifact-test-")); roots.push(root)
  await mkdir(join(root, "classes"), { mode: 0o700 }); await mkdir(join(root, "lib"), { mode: 0o700 })
  const contents = {
    "classes/KafkaPartitionBridge.class": "synthetic-class-bytes-not-executable",
    "lib/kafka-clients-4.3.1.jar": "synthetic-jar-bytes-not-executable",
    "logging.properties": "status=OFF\nrootLogger.level=OFF\n",
  }
  for (const [path, value] of Object.entries(contents)) await writeFile(join(root, path), value, { mode: 0o600 })
  const manifest = { apiVersion: "event-platform.leaddrive.io/v1", kind: "KafkaBridgeArtifact", releaseSha: SHA,
    kafkaVersion: "4.3.1", files: Object.entries(contents).map(([path, value]) => ({ path, bytes: Buffer.byteLength(value), sha256: hash(value) })) }
  async function seal() {
    const text = JSON.stringify(manifest)
    await writeFile(join(root, "manifest.json"), text, { mode: 0o600 })
    return { root, expectedReleaseSha: SHA, expectedManifestSha256: hash(text) }
  }
  return { root, manifest, seal, input: await seal() }
}
const reject = async (input: Parameters<typeof verifyKafkaWorkerArtifact>[0]) => {
  await expect(verifyKafkaWorkerArtifact(input)).rejects.toMatchObject({
    name: "KafkaWorkerArtifactError", code: "KAFKA_WORKER_ARTIFACT_INVALID", message: "Kafka worker artifact verification failed",
  })
}

describe("worker artifact byte verification", () => {
  it("returns frozen explicit classpath after reading independently pinned manifest and every member", async () => {
    const f = await fixture(), value = await verifyKafkaWorkerArtifact(f.input)
    expect(value.releaseSha).toBe(SHA)
    expect(value.classpath).toEqual([join(f.root, "classes"), join(f.root, "lib/kafka-clients-4.3.1.jar")])
    expect(value.manifestSha256).toBe(f.input.expectedManifestSha256)
    expect(Object.isFrozen(value)).toBe(true); expect(Object.isFrozen(value.classpath)).toBe(true)
    expect(value.classpath.some(path => path.includes("*"))).toBe(false)
  })
  it("rejects release and approved manifest digest mismatch", async () => {
    const f = await fixture()
    await reject({ ...f.input, expectedReleaseSha: "b".repeat(40) })
    await reject({ ...f.input, expectedManifestSha256: `sha256:${"0".repeat(64)}` })
  })
  it("rejects changed class bytes even with equal size", async () => {
    const f = await fixture(), path = join(f.root, "classes/KafkaPartitionBridge.class")
    const bytes = await readFile(path); bytes[0] ^= 1; await writeFile(path, bytes)
    await reject(f.input)
  })
  it.each(["lib/injected.jar", "classes/Injected.class"])("rejects unlisted %s instead of letting classpath discovery load it", async path => {
    const f = await fixture()
    await writeFile(join(f.root, path), "payload")
    await reject(f.input)
  })
  it("rejects extra top-level content", async () => {
    const f = await fixture(); await writeFile(join(f.root, "agent.jar"), "payload"); await reject(f.input)
  })
  it("rejects a classpath delimiter in the artifact root", async () => {
    const f = await fixture(), path = f.root + ":injected"
    await rename(f.root, path); roots.push(path)
    await reject({ ...f.input, root: path })
  })
  it.each(["manifest.json", "classes/KafkaPartitionBridge.class"])("rejects FIFO %s without blocking open", async name => {
    const f = await fixture(), path = join(f.root, name)
    await rm(path); execFileSync("mkfifo", [path], { timeout: 1000 }); fifos.push(path)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([reject(f.input), new Promise<never>((_, fail) => {
        timer = setTimeout(() => fail(new Error("FIFO guard blocked")), 500)
      })])
    } finally { clearTimeout(timer) }
  })
  it("rejects symlink members, directories and roots", async () => {
    const f = await fixture(), external = await fixture(), target = join(f.root, "classes/KafkaPartitionBridge.class")
    await rm(target); await symlink(join(external.root, "classes/KafkaPartitionBridge.class"), target)
    await reject(f.input)
    const g = await fixture(); await rm(join(g.root, "classes"), { recursive: true }); await symlink(join(external.root, "classes"), join(g.root, "classes"))
    await reject(g.input)
    const alias = join(f.root, "alias"); await symlink(g.root, alias); await reject({ ...g.input, root: alias })
  })
  it("rejects hard-linked executable content", async () => {
    const f = await fixture(); await link(join(f.root, "classes/KafkaPartitionBridge.class"), join(f.root, "lib/link.jar"))
    // Remove the alias from traversal by declaring it: the link count must still fail.
    const entry = f.manifest.files[0]; f.manifest.files.push({ ...entry, path: "lib/link.jar" })
    await reject(await f.seal())
  })
  it.each(["root", "classes", "lib/kafka-clients-4.3.1.jar", "manifest.json"])("rejects group writable %s", async path => {
    const f = await fixture(); await chmod(path === "root" ? f.root : join(f.root, path), path === "root" || path === "classes" ? 0o770 : 0o660)
    await reject(f.input)
  })
  it("rejects traversal, duplicates, missing main and missing client", async () => {
    for (const defect of ["traversal", "duplicate", "main", "client"]) {
      const f = await fixture()
      if (defect === "traversal") f.manifest.files[0].path = "classes/../../private"
      if (defect === "duplicate") f.manifest.files.push({ ...f.manifest.files[0] })
      if (defect === "main") f.manifest.files = f.manifest.files.filter(e => !e.path.endsWith(".class"))
      if (defect === "client") f.manifest.files = f.manifest.files.filter(e => !e.path.endsWith(".jar"))
      await reject(await f.seal())
    }
  })
  it("rejects wrong sizes, component versions and executable logging configuration", async () => {
    const f = await fixture(); f.manifest.files[0].bytes++; await reject(await f.seal())
    const g = await fixture(); g.manifest.kafkaVersion = "latest"; await reject(await g.seal())
    const h = await fixture(), logging = "rootLogger.appenderRef.remote.ref=REMOTE\n"
    await writeFile(join(h.root, "logging.properties"), logging)
    const entry = h.manifest.files.find(e => e.path === "logging.properties")!; entry.bytes = Buffer.byteLength(logging); entry.sha256 = hash(logging)
    await reject(await h.seal())
  })
  it("bounds file count and sizes before allocating payloads", async () => {
    const f = await fixture(); f.manifest.files[0].bytes = 64 * 1024 * 1024 + 1; await reject(await f.seal())
    const g = await fixture(); g.manifest.files = Array.from({ length: 257 }, () => g.manifest.files[0]); await reject(await g.seal())
  })
  it("rejects unknown fields and malformed files with sanitized failures", async () => {
    const f = await fixture(); Object.assign(f.manifest, { secret: "private-value" }); await reject(await f.seal())
    await expect(verifyKafkaWorkerArtifact({ ...f.input, root: "/missing-private-value" })).rejects.toBeInstanceOf(KafkaWorkerArtifactError)
  })
})
