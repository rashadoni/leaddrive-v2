import { fetchZeytunClientsSoap, parseZeytunClientsConfig, zeytunClientsScopeKey } from "./zeytun-clients-client"
import { ZeytunClientsDirectory, ZeytunClientsDirectoryError } from "./zeytun-clients-directory"
import { ZeytunSnapshotStore, ZeytunSnapshotStoreError, type ZeytunRefreshAttempt } from "./zeytun-snapshot-store"

const INTERVAL = 3_600_000

/** Hourly background directory refresh, sharing the balances worker's on-host
 * lock root. No automatic timer, per-call I/O or mass per-customer stock requests.
 */
export class ZeytunClientsCache {
  private readonly config: ReturnType<typeof parseZeytunClientsConfig>
  readonly scopeKey: string
  private directory: ZeytunClientsDirectory | null = null
  private attempt: ZeytunRefreshAttempt | null = null
  private storageError = false
  private inFlight: Promise<ReturnType<ZeytunClientsCache["result"]>> | null = null

  constructor(input: unknown, private readonly store: ZeytunSnapshotStore,
    private readonly fetchDirectory = fetchZeytunClientsSoap, private readonly clock: () => number = Date.now) {
    this.config = parseZeytunClientsConfig(input)
    this.scopeKey = zeytunClientsScopeKey(this.config)
    if (store.organizationId !== this.config.organizationId || store.scopeKey !== this.scopeKey) throw new ZeytunClientsDirectoryError("tenant_mismatch")
  }

  async restore() {
    try {
      await this.restoreSnapshot()
      this.attempt = await this.store.readAttempt()
      this.storageError = false
      return this.directory !== null
    } catch { this.storageError = true; return false }
  }

  /** Server-side only. Caller must still check source freshness and CRM review. */
  current(organizationId: string) {
    if (organizationId !== this.config.organizationId) throw new ZeytunClientsDirectoryError("tenant_mismatch")
    return this.storageError ? null : this.directory
  }

  status() {
    const summary = this.directory?.summary(this.config.organizationId)
    return {
      scopeKey: this.scopeKey, version: summary?.version ?? null, observedAt: summary?.observedAt ?? null,
      clientCount: summary?.clientCount ?? 0, missingPhoneCount: summary?.missingPhoneCount ?? 0,
      unrecognizedPhoneCount: summary?.unrecognizedPhoneCount ?? 0, sharedPhoneCount: summary?.sharedPhoneCount ?? 0,
      clientsWithSharedPhoneCount: summary?.clientsWithSharedPhoneCount ?? 0,
      nextAttemptAt: this.attempt?.nextAttemptAt ?? null,
      lastError: this.storageError ? "storage_failed" as const : this.attempt?.lastError ?? null,
      canAuthorizeCall: false as const,
    }
  }
  refresh() {
    if (this.inFlight) return this.inFlight
    this.inFlight = this.refreshOnce().finally(() => { this.inFlight = null })
    return this.inFlight
  }
  private result(outcome: "updated" | "throttled" | "busy" | "failed") { return { outcome, ...this.status() } }

  private async refreshOnce() {
    try {
      const locked = await this.store.withLock(async () => {
        this.attempt = await this.store.readAttempt()
        try { await this.restoreSnapshot() } catch { this.storageError = true }
        const now = this.clock()
        if (this.attempt && now < this.attempt.nextAttemptAt) return this.result("throttled")
        const failures = Math.min(32, (this.attempt?.failures ?? 0) + 1)
        const delay = Math.min(6 * INTERVAL, INTERVAL * 2 ** (failures - 1))
        // Persist before I/O so a restart cannot cause a rapid repeated 1C query.
        this.attempt = { scopeKey: this.scopeKey, attemptedAt: now, nextAttemptAt: now + delay, failures, lastError: "interrupted" }
        await this.store.saveAttempt(this.attempt)
        try {
          const read = await this.fetchDirectory(this.config)
          if (read.scopeKey !== this.scopeKey || read.context.organizationId !== this.config.organizationId ||
              read.context.source !== "live" || Date.parse(read.context.observedAt) > this.clock()) throw new Error()
          const next = new ZeytunClientsDirectory(read.payload, read.context)
          const summary = next.summary(this.config.organizationId)
          await this.store.save({ payload: read.payload, version: summary.version, context: read.context })
          const attempt = { scopeKey: this.scopeKey, attemptedAt: now, nextAttemptAt: this.clock() + INTERVAL, failures: 0, lastError: null }
          await this.store.saveAttempt(attempt)
          this.directory = next; this.attempt = attempt; this.storageError = false
          return this.result("updated")
        } catch (error) {
          this.attempt = { scopeKey: this.scopeKey, attemptedAt: now, nextAttemptAt: this.clock() + delay, failures,
            lastError: error instanceof ZeytunSnapshotStoreError ? "storage_failed" : "read_failed" }
          await this.store.saveAttempt(this.attempt)
          return this.result("failed")
        }
      })
      return locked.acquired ? locked.value : this.result("busy")
    } catch { this.storageError = true; return this.result("failed") }
  }

  private async restoreSnapshot() {
    const saved = await this.store.load()
    if (!saved) return
    const summary = this.directory?.summary(this.config.organizationId)
    if (saved.version === summary?.version && saved.context.observedAt === summary?.observedAt && saved.context.source === summary?.source) return
    this.directory = new ZeytunClientsDirectory(saved.payload, saved.context)
  }
}
