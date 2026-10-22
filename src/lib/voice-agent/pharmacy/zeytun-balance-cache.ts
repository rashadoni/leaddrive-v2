import { PharmacyOrderError } from "./contracts"
import { ZeytunAvailableBalances } from "./zeytun-available-balances"
import { fetchZeytunAvailableBalances, parseZeytunBalanceConfig, zeytunBalanceScopeKey } from "./zeytun-balance-client"
import { ZeytunSnapshotStore, ZeytunSnapshotStoreError, type ZeytunRefreshAttempt } from "./zeytun-snapshot-store"

type FeedSummary = ReturnType<ZeytunAvailableBalances["summary"]>
type Outcome = "updated" | "throttled" | "busy" | "failed"

/** Background-worker cache for one verified tenant/counterparty/warehouse scope.
 * No timer starts on import/construction. Phone search never triggers I/O.
 */
export class ZeytunBalanceCache {
  private readonly config: ReturnType<typeof parseZeytunBalanceConfig>
  readonly scopeKey: string
  private feed: ZeytunAvailableBalances | null = null
  private summary: FeedSummary | null = null
  private attempt: ZeytunRefreshAttempt | null = null
  private storageError = false
  private inFlight: Promise<ReturnType<ZeytunBalanceCache["result"]>> | null = null

  constructor(
    input: unknown,
    private readonly store: ZeytunSnapshotStore,
    private readonly fetchFeed = fetchZeytunAvailableBalances,
    private readonly clock: () => number = Date.now,
    private readonly refreshIntervalMs = 15 * 60_000,
    private readonly staleAfterMs = 30 * 60_000,
  ) {
    this.config = parseZeytunBalanceConfig(input)
    this.scopeKey = zeytunBalanceScopeKey(this.config)
    if (store.scopeKey !== this.scopeKey || store.organizationId !== this.config.organizationId ||
        !Number.isSafeInteger(refreshIntervalMs) || refreshIntervalMs < 60_000 || refreshIntervalMs > 3_600_000 ||
        !Number.isSafeInteger(staleAfterMs) || staleAfterMs < refreshIntervalMs || staleAfterMs > 86_400_000) {
      throw new PharmacyOrderError("invalid_request")
    }
  }

  /** Call at worker startup/reload, never once per spoken line. */
  async restore(): Promise<boolean> {
    try {
      await this.restoreSnapshot()
      this.attempt = await this.store.readAttempt()
      this.storageError = false
      return this.feed !== null
    } catch {
      this.storageError = true
      return false
    }
  }

  status() {
    const observedAt = this.summary?.observedAt ?? null
    const observedMs = observedAt === null ? null : Date.parse(observedAt)
    const ageMs = observedMs === null ? null : this.clock() - observedMs
    return {
      scopeKey: this.scopeKey, catalogVersion: this.summary?.version ?? null,
      itemCount: this.summary?.itemCount ?? 0, observedAt,
      source: this.summary?.source ?? null,
      snapshotAgeMs: ageMs === null ? null : Math.max(0, ageMs),
      // "recent" only dates our observation, never the stock generation time.
      observationStatus: ageMs === null ? "unavailable" as const
        : ageMs < 0 || ageMs >= this.staleAfterMs || this.summary?.source !== "live" ? "stale" as const : "recent" as const,
      nextAttemptAt: this.attempt?.nextAttemptAt ?? null,
      lastError: this.storageError ? "storage_failed" as const : this.attempt?.lastError ?? null,
      sourceGeneratedAt: null, coverage: "unverified" as const,
      canQuote: false as const, canSubmitTo1c: false as const,
    }
  }

  /** Scope must come from authenticated call/customer binding, not model args. */
  search(organizationId: string, scopeKey: string, query: unknown) {
    if (organizationId !== this.config.organizationId || scopeKey !== this.scopeKey) throw new PharmacyOrderError("tenant_mismatch")
    const cache = this.status()
    if (!this.feed) return { status: "snapshot_unavailable" as const, candidates: [], candidateCount: 0, cache, canResolveIdentity: false, canSubmitTo1c: false }
    return { ...this.feed.search(organizationId, query), cache }
  }

  refresh() {
    if (this.inFlight) return this.inFlight
    this.inFlight = this.refreshOnce().finally(() => { this.inFlight = null })
    return this.inFlight
  }

  private result(outcome: Outcome) { return { outcome, ...this.status() } }

  private async refreshOnce() {
    try {
      const locked = await this.store.withLock(async () => {
        this.attempt = await this.store.readAttempt()
        // Cache corruption must not stop a valid network replacement, while a
        // corrupt rate-limit record fails closed to avoid repeated downloads.
        try { await this.restoreSnapshot() } catch { this.storageError = true }
        const now = this.clock()
        if (this.attempt && now < this.attempt.nextAttemptAt) return this.result("throttled")
        const failures = Math.min(32, (this.attempt?.failures ?? 0) + 1)
        const delay = Math.min(3_600_000, this.refreshIntervalMs * 2 ** (failures - 1))
        // Persist BEFORE I/O: a killed worker/restart cannot immediately retry.
        this.attempt = { scopeKey: this.scopeKey, attemptedAt: now, nextAttemptAt: now + delay, failures, lastError: "interrupted" }
        await this.store.saveAttempt(this.attempt)
        try {
          const downloaded = await this.fetchFeed(this.config)
          const summary = downloaded.feed.summary(this.config.organizationId)
          if (downloaded.scopeKey !== this.scopeKey || summary.source !== "live" || Date.parse(summary.observedAt) > this.clock()) {
            throw new PharmacyOrderError("invalid_catalog")
          }
          await this.store.save({ payload: downloaded.payload, version: summary.version, context: {
            organizationId: this.config.organizationId, observedAt: summary.observedAt, source: summary.source,
          } })
          this.feed = downloaded.feed
          this.summary = summary
          this.attempt = { scopeKey: this.scopeKey, attemptedAt: now, nextAttemptAt: this.clock() + this.refreshIntervalMs, failures: 0, lastError: null }
          await this.store.saveAttempt(this.attempt)
          this.storageError = false
          return this.result("updated")
        } catch (error) {
          this.attempt = { scopeKey: this.scopeKey, attemptedAt: now, nextAttemptAt: this.clock() + delay, failures,
            lastError: error instanceof ZeytunSnapshotStoreError ? "storage_failed" : "read_failed" }
          await this.store.saveAttempt(this.attempt)
          return this.result("failed")
        }
      })
      return locked.acquired ? locked.value : this.result("busy")
    } catch {
      this.storageError = true
      return this.result("failed")
    }
  }

  private async restoreSnapshot(): Promise<void> {
    const stored = await this.store.load()
    if (!stored || (stored.version === this.summary?.version && stored.context.observedAt === this.summary?.observedAt && stored.context.source === this.summary?.source)) return
    const next = new ZeytunAvailableBalances(stored.payload, stored.context)
    this.summary = next.summary(this.config.organizationId)
    this.feed = next
  }
}
