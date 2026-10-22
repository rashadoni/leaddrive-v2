import { constants } from "node:fs"
import { open } from "node:fs/promises"
import { isAbsolute } from "node:path"
import { setTimeout } from "node:timers/promises"

import { ZeytunBalanceCache } from "./zeytun-balance-cache"
import { parseZeytunBalanceConfig, zeytunBalanceScopeKey } from "./zeytun-balance-client"
import { ZeytunSnapshotStore } from "./zeytun-snapshot-store"

/** Explicit operator entrypoint; compile as CommonJS, never import in a route.
 * Configuration/response bytes/errors are never printed. No implicit defaults
 * for tenant, customer, warehouse, credentials or the private cache directory.
 */
async function main() {
  const mode = process.argv[2]
  const configPath = process.env.ZEYTUN_CONFIG_FILE
  const directory = process.env.ZEYTUN_CACHE_DIR
  if (!["--once", "--watch", "--status"].includes(mode) || !configPath || !isAbsolute(configPath) || !directory) throw new Error("invalid_configuration")
  const file = await open(configPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  let input: unknown
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.() || stat.size < 1 || stat.size > 16_384) throw new Error("invalid_configuration")
    const bytes = Buffer.alloc(stat.size)
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
    if (bytesRead !== bytes.length) throw new Error("invalid_configuration")
    input = JSON.parse(bytes.toString("utf8"))
  } finally { await file.close() }
  const config = parseZeytunBalanceConfig(input)
  const cache = new ZeytunBalanceCache(config, new ZeytunSnapshotStore(directory, config.organizationId, zeytunBalanceScopeKey(config)))
  await cache.restore()
  if (mode === "--status") {
    console.log(JSON.stringify(cache.status()))
    return
  }
  const stop = new AbortController()
  const abort = () => stop.abort()
  process.once("SIGINT", abort)
  process.once("SIGTERM", abort)
  try {
    do {
      const result = await cache.refresh()
      console.log(JSON.stringify(result))
      if (mode === "--once") {
        if (result.outcome === "failed") process.exitCode = 1
        break
      }
      // The lock and persisted deadline also guard overlapping worker instances.
      const waitMs = Math.max(60_000, Math.min(3_600_000, (result.nextAttemptAt ?? Date.now() + 900_000) - Date.now()))
      await setTimeout(waitMs, undefined, { signal: stop.signal }).catch((error: unknown) => {
        if (!stop.signal.aborted) throw error
      })
    } while (!stop.signal.aborted)
  } finally {
    process.removeListener("SIGINT", abort)
    process.removeListener("SIGTERM", abort)
  }
}

if (require.main === module) {
  main().catch(() => {
    console.error(JSON.stringify({ outcome: "failed", error: "zeytun_refresh_unavailable" }))
    process.exitCode = 1
  })
}
