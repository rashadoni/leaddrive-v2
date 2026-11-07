/**
 * Slow database statements, one JSON line each in the process's out-log:
 *
 *   {"evt":"slow_query","ms":812,"target":"quaint::connector::metrics","sql":"SELECT … FROM \"public\".\"deals\" WHERE …"}
 *
 * Prisma measures every statement itself and reports it as a `query` event
 * when the client is built with `log: [{ emit: "event", level: "query" }]`;
 * here only the ones at or above the threshold are written. The SQL text is
 * Prisma's parameterised statement (`$1`, `$2` …) — the values are in a
 * separate field that is never read, so no customer data reaches the log.
 *
 * Threshold: `DB_SLOW_QUERY_MS` (default 500 ms; `0` turns the log off and
 * the client is then built without the query event at all). Off in tests.
 *
 * Reading it on prod: `pm2 logs leaddrive-v2 --nostream --lines 5000 | grep slow_query`.
 */

const DEFAULT_SLOW_QUERY_MS = 500
const SQL_MAX_CHARS = 600

export function slowQueryThresholdMs(env: Record<string, string | undefined> = process.env): number {
  if (env.NODE_ENV === "test" || env.VITEST) return 0
  const raw = env.DB_SLOW_QUERY_MS
  if (raw === undefined || raw.trim() === "") return DEFAULT_SLOW_QUERY_MS
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
}

/** Prisma client options that make it report statement timings, or none when off. */
export function slowQueryClientOptions(thresholdMs: number): { log: Array<{ emit: "event"; level: "query" }> } | undefined {
  return thresholdMs > 0 ? { log: [{ emit: "event", level: "query" }] } : undefined
}

type QueryEvent = { duration?: number | bigint; query?: string; target?: string }

export function slowQueryLine(event: QueryEvent, thresholdMs: number): string | null {
  const ms = Number(event.duration)
  if (!Number.isFinite(ms) || thresholdMs <= 0 || ms < thresholdMs) return null
  const sql = String(event.query ?? "").replace(/\s+/g, " ").trim()
  return JSON.stringify({
    evt: "slow_query",
    ms,
    target: event.target ?? undefined,
    sql: sql.length > SQL_MAX_CHARS ? `${sql.slice(0, SQL_MAX_CHARS)}…` : sql,
  })
}

/** Subscribe the base client to its own query events; a no-op on a client without `$on`. */
export function attachSlowQueryLog(client: unknown, thresholdMs: number): void {
  if (thresholdMs <= 0) return
  const on = (client as { $on?: (event: "query", cb: (e: QueryEvent) => void) => void })?.$on
  if (typeof on !== "function") return
  on.call(client, "query", (event: QueryEvent) => {
    try {
      const line = slowQueryLine(event, thresholdMs)
      if (line) process.stdout.write(`${line}\n`)
    } catch {
      /* observation must never break a query */
    }
  })
}
