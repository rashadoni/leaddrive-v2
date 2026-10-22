import { spawn } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { constants, type Stats } from "node:fs"
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import { z } from "zod"

import { ZEYTUN_BALANCES_MAX_BYTES, type ZeytunBalancesContext } from "./zeytun-available-balances"

const keySchema = z.string().regex(/^[a-f0-9]{64}$/)
const metadataSchema = z.strictObject({
  format: z.literal(1), scopeKey: keySchema, version: keySchema,
  organizationId: z.string().min(1).max(128),
  observedAt: z.iso.datetime({ offset: true }), source: z.enum(["attachment", "live"]),
})
const attemptSchema = z.strictObject({
  scopeKey: keySchema,
  attemptedAt: z.number().int().nonnegative(),
  nextAttemptAt: z.number().int().nonnegative(),
  failures: z.number().int().min(0).max(32),
  lastError: z.enum(["read_failed", "storage_failed", "interrupted"]).nullable(),
}).refine((value) => value.nextAttemptAt >= value.attemptedAt)
export type ZeytunRefreshAttempt = z.infer<typeof attemptSchema>
export type ZeytunStoredSnapshot = {
  payload: Uint8Array
  context: ZeytunBalancesContext
  version: string
}

export class ZeytunSnapshotStoreError extends Error {
  constructor() { super("snapshot_storage_unavailable"); this.name = "ZeytunSnapshotStoreError" }
}

/** Private, single-host pilot storage. Use one shared root on a local Linux disk.
 * Public methods mask filesystem paths and payloads; no credentials are stored.
 */
export class ZeytunSnapshotStore {
  constructor(private readonly root: string, readonly organizationId: string, readonly scopeKey: string) {
    if (!isAbsolute(root) || !keySchema.safeParse(scopeKey).success || !organizationId.trim() || organizationId.length > 128) {
      throw new ZeytunSnapshotStoreError()
    }
  }

  async load(): Promise<ZeytunStoredSnapshot | null> {
    return this.safe(async () => {
      const bytes = await this.read(`${this.scopeKey}.snapshot`, ZEYTUN_BALANCES_MAX_BYTES + 2048)
      if (!bytes) return null
      const separator = bytes.indexOf(10)
      if (separator < 1 || separator > 2048) throw new ZeytunSnapshotStoreError()
      const metadata = metadataSchema.parse(JSON.parse(bytes.subarray(0, separator).toString("utf8")))
      const payload = bytes.subarray(separator + 1)
      if (metadata.scopeKey !== this.scopeKey || metadata.organizationId !== this.organizationId ||
          !payload.length || payload.length > ZEYTUN_BALANCES_MAX_BYTES ||
          createHash("sha256").update(payload).digest("hex") !== metadata.version) throw new ZeytunSnapshotStoreError()
      return {
        payload, version: metadata.version,
        context: { organizationId: metadata.organizationId, observedAt: metadata.observedAt, source: metadata.source },
      }
    })
  }

  /** Caller validates the entire feed before saving, while holding withLock. */
  async save(snapshot: ZeytunStoredSnapshot): Promise<void> {
    return this.safe(async () => {
      const metadata = metadataSchema.parse({ format: 1, scopeKey: this.scopeKey, version: snapshot.version, ...snapshot.context })
      if (metadata.organizationId !== this.organizationId || metadata.scopeKey !== this.scopeKey || !snapshot.payload.byteLength ||
          snapshot.payload.byteLength > ZEYTUN_BALANCES_MAX_BYTES ||
          createHash("sha256").update(snapshot.payload).digest("hex") !== snapshot.version) throw new ZeytunSnapshotStoreError()
      await this.atomicWrite(`${this.scopeKey}.snapshot`, [Buffer.from(`${JSON.stringify(metadata)}\n`), snapshot.payload])
    })
  }

  async readAttempt(): Promise<ZeytunRefreshAttempt | null> {
    return this.safe(async () => {
      const bytes = await this.read(`${this.scopeKey}.attempt`, 2048)
      if (!bytes) return null
      const result = attemptSchema.parse(JSON.parse(bytes.toString("utf8")))
      if (result.scopeKey !== this.scopeKey) throw new ZeytunSnapshotStoreError()
      return result
    })
  }

  async saveAttempt(attempt: ZeytunRefreshAttempt): Promise<void> {
    return this.safe(async () => {
      const parsed = attemptSchema.parse(attempt)
      if (parsed.scopeKey !== this.scopeKey) throw new ZeytunSnapshotStoreError()
      await this.atomicWrite(`${this.scopeKey}.attempt`, [Buffer.from(JSON.stringify(parsed))])
    })
  }

  /** Serializes all scopes sharing this root, including different pharmacies.
   * Linux flock belongs to the open file description: the parent retains the
   * lock after the helper exits; close/crash releases it. Never unlink this file.
   * https://man7.org/linux/man-pages/man2/flock.2.html
   */
  async withLock<T>(work: () => Promise<T>): Promise<{ acquired: false } | { acquired: true; value: T }> {
    return this.safe(async () => {
      await this.ensureRoot()
      const handle = await open(join(this.root, "refresh.lock"), constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600)
      try {
        this.assertPrivateFile(await handle.stat())
        const code = await new Promise<number | null>((resolve, reject) => {
          const child = spawn("flock", ["--nonblock", "--conflict-exit-code", "75", "3"], {
            stdio: ["ignore", "ignore", "ignore", handle.fd], timeout: 5000,
          })
          child.once("error", reject)
          child.once("exit", resolve)
        })
        if (code === 75) return { acquired: false }
        if (code !== 0) throw new ZeytunSnapshotStoreError()
        return { acquired: true, value: await work() }
      } finally { await handle.close() }
    })
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const stat = await lstat(this.root)
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) {
      throw new ZeytunSnapshotStoreError()
    }
  }

  private assertPrivateFile(stat: Stats): void {
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) {
      throw new ZeytunSnapshotStoreError()
    }
  }

  private async read(name: string, cap: number): Promise<Buffer | null> {
    await this.ensureRoot()
    let handle
    try { handle = await open(join(this.root, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
      throw error
    }
    try {
      const stat = await handle.stat()
      this.assertPrivateFile(stat)
      if (stat.size < 1 || stat.size > cap) throw new ZeytunSnapshotStoreError()
      // Read only the checked size; an expanding file cannot cause an unbounded read.
      const bytes = Buffer.alloc(stat.size)
      let offset = 0
      while (offset < bytes.length) {
        const read = await handle.read(bytes, offset, bytes.length - offset, offset)
        if (!read.bytesRead) throw new ZeytunSnapshotStoreError()
        offset += read.bytesRead
      }
      return bytes
    } finally { await handle.close() }
  }

  private async atomicWrite(name: string, chunks: readonly Uint8Array[]): Promise<void> {
    await this.ensureRoot()
    const temporary = join(this.root, `.${name}.${randomUUID()}.tmp`)
    try {
      const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
      try {
        for (const chunk of chunks) await handle.writeFile(chunk)
        await handle.sync()
      } finally { await handle.close() }
      await rename(temporary, join(this.root, name))
      const directory = await open(this.root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
      try { await directory.sync() } finally { await directory.close() }
    } finally { await unlink(temporary).catch(() => undefined) }
  }

  private async safe<T>(work: () => Promise<T>): Promise<T> {
    try { return await work() } catch { throw new ZeytunSnapshotStoreError() }
  }
}
