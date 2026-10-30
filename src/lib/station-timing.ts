/**
 * How long the CRM took to answer each question the phone station asked.
 *
 * Owner, 2026-10-28: a call to Zeytun's line dropped after the first ring
 * because the CRM answered the station's "ringing" in 1–4 s instead of 0.1 s,
 * and nothing on the CRM side said so — the delay was found from the station's
 * journal. One line per station request now, on stdout (the pm2 out log of the
 * process that answered):
 *
 *   {"evt":"station_timing","route":"pharmacy-inbound","step":"lookup",
 *    "status":200,"ms":12,"queuedMs":3,"proc":"line"}
 *
 * `ms` is the handler's own time. `queuedMs` is how long the request waited
 * before the handler started — in nginx's queue and on a busy event loop —
 * taken from the X-Request-Start header nginx stamps on station routes
 * (ops/nginx/leaddrive-station-routes.conf); without that header it is absent.
 * Written with process.stdout, not console, so route tests that spy on the
 * console see nothing new.
 */

export type ProcessRole = "web" | "jobs" | "line"

/** Which pm2 process this is (ecosystem.config.cjs sets it); "web" otherwise. */
export function processRole(): ProcessRole {
  const role = process.env.LEADDRIVE_PROCESS_ROLE
  return role === "jobs" || role === "line" ? role : "web"
}

/** Milliseconds since nginx received the request, from `t=<seconds.millis>`. */
export function queuedSince(header: string | null, now = Date.now()): number | undefined {
  const match = /^t=(\d+(?:\.\d+)?)$/.exec(header?.trim() ?? "")
  if (!match) return undefined
  const waited = Math.round(now - Number(match[1]) * 1000)
  return waited >= 0 && waited < 600_000 ? waited : undefined
}

const STEP = /^[a-z][a-z0-9_-]{0,39}$/i

/** The request's step — `action` (pharmacy line, handoff) or `state` (call
 * lifecycle) — and nothing else from the body: it carries phone numbers. */
async function stepOf(request: Request): Promise<string | undefined> {
  if (request.method !== "POST" || !request.body) return undefined
  try {
    const text = await request.clone().text()
    if (text.length > 65_536) return undefined
    const value = JSON.parse(text) as { action?: unknown; state?: unknown }
    const step = typeof value?.action === "string" ? value.action : value?.state
    return typeof step === "string" && STEP.test(step) ? step : undefined
  } catch {
    return undefined
  }
}

export function withStationTiming<A extends unknown[], R extends Request>(
  route: string,
  handler: (request: R, ...rest: A) => Promise<Response> | Response,
): (request: R, ...rest: A) => Promise<Response> {
  return async (request, ...rest) => {
    const started = Date.now()
    const queuedMs = queuedSince(request.headers.get("x-request-start"), started)
    const step = await stepOf(request)
    let status = 500
    try {
      const response = await handler(request, ...rest)
      status = response.status
      return response
    } finally {
      const line = { evt: "station_timing", route, ...(step ? { step } : {}), status,
        ms: Date.now() - started, ...(queuedMs === undefined ? {} : { queuedMs }), proc: processRole() }
      process.stdout.write(`${JSON.stringify(line)}\n`)
    }
  }
}
