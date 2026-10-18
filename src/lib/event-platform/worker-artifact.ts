import { createHash } from "node:crypto"
import { constants } from "node:fs"
import { lstat, open, opendir, realpath } from "node:fs/promises"
import { delimiter, isAbsolute, join, resolve } from "node:path"

const SHA = /^[0-9a-f]{40}$/
const DIGEST = /^sha256:[0-9a-f]{64}$/
const MAX_FILES = 256
const MAX_FILE_BYTES = 64 * 1024 * 1024
const MAX_TOTAL_BYTES = 256 * 1024 * 1024

export class KafkaWorkerArtifactError extends Error {
  readonly code = "KAFKA_WORKER_ARTIFACT_INVALID"
  constructor() { super("Kafka worker artifact verification failed"); this.name = "KafkaWorkerArtifactError" }
}

export interface VerifiedKafkaWorkerArtifact {
  readonly releaseSha: string
  readonly manifestSha256: string
  readonly root: string
  readonly classpath: readonly string[]
  readonly loggingConfiguration: string
}

function requireValue(ok: unknown): asserts ok { if (!ok) throw new KafkaWorkerArtifactError() }
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value))
  requireValue(Object.getPrototypeOf(value) === Object.prototype)
  const result = value as Record<string, unknown>
  requireValue(Object.keys(result).length === keys.length && keys.every(key => Object.hasOwn(result, key)))
  return result
}
const digest = (bytes: Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`

/**
 * Verifies actual bytes against an independently approved manifest digest.
 * No classpath wildcard, symlink, writable group/world file, unlisted class or
 * extra JAR is accepted. Does not connect, spawn, approve activation or prove
 * the provenance of an expected digest supplied by its trusted caller.
 *
 * Deployment must keep this tree read-only to the execution principal for the
 * complete process lifetime. A hash check is not an OS lock against its owner
 * changing files after verification, nor a substitute for release provenance.
 */
export async function verifyKafkaWorkerArtifact(input: {
  root: string
  expectedReleaseSha: string
  expectedManifestSha256: string
}): Promise<VerifiedKafkaWorkerArtifact> {
  try {
    const { root, expectedReleaseSha, expectedManifestSha256 } = input
    requireValue(typeof root === "string" && isAbsolute(root) && resolve(root) === root && !root.includes(delimiter))
    requireValue(SHA.test(expectedReleaseSha) && DIGEST.test(expectedManifestSha256))
    requireValue(await realpath(root) === root)
    const rootStat = await lstat(root)
    requireValue(rootStat.isDirectory() && (rootStat.mode & 0o022) === 0)
    const owner = rootStat.uid
    async function readChecked(path: string, limit: number): Promise<Buffer> {
      const file = await open(join(root, path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      try {
        const before = await file.stat()
        requireValue(before.isFile() && before.uid === owner && before.nlink === 1
          && (before.mode & 0o022) === 0 && before.size > 0 && before.size <= limit)
        // Fixed allocation and at most one extra byte also bound a file which
        // grows after fstat; readFile() would allocate its changed size.
        const bytes = Buffer.alloc(before.size + 1)
        let length = 0
        while (length < bytes.length) {
          const result = await file.read(bytes, length, bytes.length - length, null)
          if (result.bytesRead === 0) break
          length += result.bytesRead
        }
        const after = await file.stat()
        requireValue(length === before.size && after.size === before.size
          && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs)
        return bytes.subarray(0, length)
      } finally { await file.close() }
    }
    const manifestBytes = await readChecked("manifest.json", 128 * 1024)
    requireValue(digest(manifestBytes) === expectedManifestSha256)
    const manifest = object(JSON.parse(manifestBytes.toString("utf8")),
      ["apiVersion", "kind", "releaseSha", "kafkaVersion", "files"])
    requireValue(manifest.apiVersion === "event-platform.leaddrive.io/v1" && manifest.kind === "KafkaBridgeArtifact"
      && manifest.releaseSha === expectedReleaseSha && manifest.kafkaVersion === "4.3.1")
    requireValue(Array.isArray(manifest.files) && manifest.files.length >= 3 && manifest.files.length <= MAX_FILES)
    const paths = new Set<string>()
    const jars: string[] = []
    let total = 0
    for (const raw of manifest.files) {
      const entry = object(raw, ["path", "bytes", "sha256"])
      requireValue(typeof entry.path === "string" && typeof entry.sha256 === "string" && DIGEST.test(entry.sha256)
        && Number.isSafeInteger(entry.bytes) && (entry.bytes as number) > 0 && (entry.bytes as number) <= MAX_FILE_BYTES)
      const path = entry.path
      requireValue(path === "logging.properties" || /^classes\/KafkaPartitionBridge(?:\$[A-Za-z0-9_]+)?\.class$/.test(path)
        || /^lib\/[A-Za-z0-9][A-Za-z0-9_.-]{0,150}\.jar$/.test(path))
      requireValue(!paths.has(path))
      paths.add(path)
      total += entry.bytes as number
      requireValue(total <= MAX_TOTAL_BYTES)
      if (path.startsWith("lib/")) jars.push(path)
    }
    requireValue(paths.has("classes/KafkaPartitionBridge.class") && paths.has("logging.properties")
      && paths.has("lib/kafka-clients-4.3.1.jar") && jars.length > 0)
    // Reject unlisted payloads and directory symlinks BEFORE opening any member.
    const actual = new Set<string>()
    async function names(directory: string, max: number) {
      const result: string[] = []
      for await (const entry of await opendir(directory, { bufferSize: 16 })) {
        requireValue(result.length < max)
        result.push(entry.name)
      }
      return result
    }
    for (const name of await names(root, 4)) {
      requireValue(["manifest.json", "classes", "lib", "logging.properties"].includes(name))
      if (name === "classes" || name === "lib") {
        const stat = await lstat(join(root, name))
        requireValue(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === owner && (stat.mode & 0o022) === 0)
        for (const member of await names(join(root, name), MAX_FILES)) {
          actual.add(`${name}/${member}`)
          requireValue(actual.size <= MAX_FILES)
        }
      } else if (name !== "manifest.json") actual.add(name)
    }
    requireValue(actual.size === paths.size && [...actual].every(path => paths.has(path)))
    for (const raw of manifest.files) {
      const entry = raw as { path: string; bytes: number; sha256: string }
      const bytes = await readChecked(entry.path, MAX_FILE_BYTES)
      requireValue(bytes.length === entry.bytes && digest(bytes) === entry.sha256)
    }
    // Only the reviewed logging configuration is allowed; no lookup/plugin URI.
    requireValue((await readChecked("logging.properties", 128)).toString("utf8") === "status=OFF\nrootLogger.level=OFF\n")
    return Object.freeze({ root, releaseSha: expectedReleaseSha, manifestSha256: expectedManifestSha256,
      classpath: Object.freeze([join(root, "classes"), ...jars.sort().map(path => join(root, path))]),
      loggingConfiguration: join(root, "logging.properties") })
  } catch { throw new KafkaWorkerArtifactError() }
}
