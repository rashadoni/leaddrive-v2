import { dirname, join } from "node:path"

import { ZeytunBalanceCache } from "./zeytun-balance-cache"
import { parseZeytunBalanceConfig, zeytunBalanceScopeKey } from "./zeytun-balance-client"
import { readPrivate } from "./zeytun-inbound-host"
import { ZeytunSnapshotStore } from "./zeytun-snapshot-store"

/** The 1C connection beside the line's grant: same private directory, root 0600. */
export const ZEYTUN_CONNECTION_FILE = "zeytun-1c-connection.json"

/**
 * One refresh tick of the line's catalog. The line serves only a live snapshot
 * younger than a day, so without this tick it stops finding products a day
 * after the last manual refresh. The cache's own lock and persisted deadline
 * make overlapping or frequent ticks harmless: one download per hour at most,
 * with backoff after a failure. Nothing here is printed or returned except
 * the cache status (no endpoint, account or password).
 */
export async function refreshZeytunLineCatalog(env: { grantFile?: string; cacheDir?: string } = {
  grantFile: process.env.ZEYTUN_INBOUND_PILOT_FILE, cacheDir: process.env.ZEYTUN_CACHE_DIR,
}) {
  if (!env.grantFile || !env.cacheDir) return { outcome: "not_configured" as const }
  let input: unknown
  try { input = await readPrivate(join(dirname(env.grantFile), ZEYTUN_CONNECTION_FILE), 16_384) }
  catch { return { outcome: "not_configured" as const } }
  const config = parseZeytunBalanceConfig(input)
  const cache = new ZeytunBalanceCache(config, new ZeytunSnapshotStore(env.cacheDir, config.organizationId, zeytunBalanceScopeKey(config)),
    undefined, undefined, 60 * 60_000, 2 * 60 * 60_000)
  await cache.restore()
  return cache.refresh()
}
