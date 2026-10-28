import { dirname, join } from "node:path"

import { ZeytunBalanceCache } from "./zeytun-balance-cache"
import { parseZeytunBalanceConfig, zeytunBalanceScopeKey } from "./zeytun-balance-client"
import { ZeytunClientsCache } from "./zeytun-clients-cache"
import { parseZeytunClientsConfig, zeytunClientsScopeKey } from "./zeytun-clients-client"
import { readPrivate } from "./zeytun-private-file"
import { ZeytunSnapshotStore } from "./zeytun-snapshot-store"

/** The 1C connections beside the line's grant: same private directory, root 0600. */
export const ZEYTUN_CONNECTION_FILE = "zeytun-1c-connection.json"
/** ListClients (SOAP ZTNMOBILE): the pharmacies with their phones, for "who is calling". */
export const ZEYTUN_CLIENTS_CONNECTION_FILE = "zeytun-1c-clients.json"

type Env = { grantFile?: string; cacheDir?: string }

async function readConnectionFile(env: Env, file: string): Promise<unknown | null> {
  if (!env.grantFile || !env.cacheDir) return null
  try { return await readPrivate(join(dirname(env.grantFile), file), 16_384) }
  catch { return null }
}

/**
 * One refresh tick of the line's catalog. The line serves only a live snapshot
 * younger than a day, so without this tick it stops finding products a day
 * after the last manual refresh. The cache's own lock and persisted deadline
 * make overlapping or frequent ticks harmless: one download per hour at most,
 * with backoff after a failure. Nothing here is printed or returned except
 * the cache status (no endpoint, account or password).
 */
export async function refreshZeytunLineCatalog(env: Env = {
  grantFile: process.env.ZEYTUN_INBOUND_PILOT_FILE, cacheDir: process.env.ZEYTUN_CACHE_DIR,
}) {
  const input = await readConnectionFile(env, ZEYTUN_CONNECTION_FILE)
  if (input === null) return { outcome: "not_configured" as const }
  const config = parseZeytunBalanceConfig(input)
  const store = new ZeytunSnapshotStore(env.cacheDir!, config.organizationId, zeytunBalanceScopeKey(config))
  // Not due yet: answer from the attempt record alone. Building the cache
  // parses the stored 14 MB snapshot: about 3 s of CPU on the process that
  // answers the line's calls too, just to learn it is throttled.
  const attempt = await store.readAttempt()
  if (attempt && Date.now() < attempt.nextAttemptAt) return { outcome: "throttled" as const, nextAttemptAt: attempt.nextAttemptAt }
  const cache = new ZeytunBalanceCache(config, store, undefined, undefined, 60 * 60_000, 2 * 60 * 60_000)
  await cache.restore()
  return cache.refresh()
}

/**
 * One refresh tick of the pharmacy directory (1C ListClients), so a call can
 * be greeted by the pharmacy its number belongs to. The read takes ~95 s and
 * the directory changes rarely: the cache downloads at most hourly, with
 * backoff, under the same on-host lock as the catalog.
 */
export async function refreshZeytunPharmacies(env: Env = {
  grantFile: process.env.ZEYTUN_INBOUND_PILOT_FILE, cacheDir: process.env.ZEYTUN_CACHE_DIR,
}) {
  const input = await readConnectionFile(env, ZEYTUN_CLIENTS_CONNECTION_FILE)
  if (input === null) return { outcome: "not_configured" as const }
  const config = parseZeytunClientsConfig(input)
  const store = new ZeytunSnapshotStore(env.cacheDir!, config.organizationId, zeytunClientsScopeKey(config))
  const attempt = await store.readAttempt()
  if (attempt && Date.now() < attempt.nextAttemptAt) return { outcome: "throttled" as const, nextAttemptAt: attempt.nextAttemptAt }
  const cache = new ZeytunClientsCache(config, store)
  await cache.restore()
  const result = await cache.refresh()
  // The directory status names no pharmacy: counts, version and deadlines only.
  return { outcome: result.outcome, scopeKey: result.scopeKey, version: result.version, observedAt: result.observedAt,
    clientCount: result.clientCount, sharedPhoneCount: result.sharedPhoneCount, nextAttemptAt: result.nextAttemptAt, lastError: result.lastError }
}
