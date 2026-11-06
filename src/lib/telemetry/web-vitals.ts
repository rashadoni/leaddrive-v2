/**
 * Speed as the people using the CRM see it (real-user monitoring).
 *
 * The browser measures each page with the Web Vitals Next.js already ships
 * (`useReportWebVitals`) and, when the tab is hidden or closed, sends the
 * page's numbers in one beacon to WEB_VITALS_URI. The server writes one line:
 *
 *   {"evt":"web_vital","route":"/deals/:id","LCP":1830,"INP":96,"CLS":0.02,"TTFB":210,"conn":"4g","mem":4,"cpu":8}
 *
 * No third-party service and no customer data: the route is the path with
 * record ids replaced by `:id` and secret link segments by `[redacted]`, never
 * the query string. `conn`/`mem`/`cpu` say how fast the network and the phone
 * were, so a slow page on a weak phone can be told from a slow page.
 *
 * Reading it on prod: `pm2 logs leaddrive-v2 --nostream --lines 20000 | grep web_vital`.
 *
 * Pure module: imported by the browser reporter and by the route.
 */
import { redactOpaquePathSegments } from "@/lib/opaque-path-redaction"

export const WEB_VITALS_URI = "/api/v1/public/web-vitals"

/** Metric name → upper bound accepted (ms, except CLS which is unitless). */
export const WEB_VITAL_LIMITS = {
  LCP: 120_000,
  INP: 60_000,
  CLS: 100,
  FCP: 120_000,
  TTFB: 120_000,
  // Next.js soft navigation: click on a link → new page rendered.
  "Next.js-route-change-to-render": 120_000,
} as const

export type WebVitalName = keyof typeof WEB_VITAL_LIMITS

export function isReportedVital(name: string): name is WebVitalName {
  return Object.prototype.hasOwnProperty.call(WEB_VITAL_LIMITS, name)
}

const MAX_BEACON_BYTES = 4_096
const CONNECTION_TYPES = new Set(["slow-2g", "2g", "3g", "4g"])
// cuid / cuid2 / uuid / numeric ids — a record, not a page.
const ID_SEGMENT = /\/(?:c[a-z0-9]{20,32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9]+)(?=\/|$)/g

export function normalizeVitalsRoute(path: unknown): string {
  if (typeof path !== "string" || !path.startsWith("/")) return "/"
  const bare = path.split(/[?#]/)[0].slice(0, 300)
  return redactOpaquePathSegments(bare.replace(ID_SEGMENT, "/:id")) || "/"
}

export type WebVitalsBeacon = {
  route: string
  metrics: Partial<Record<WebVitalName, number>>
  conn?: string
  mem?: number
  cpu?: number
}

/** Parse and validate a beacon body; null for anything that is not one. */
export function parseWebVitalsBeacon(text: string): WebVitalsBeacon | null {
  if (!text || text.length > MAX_BEACON_BYTES) return null
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const body = raw as Record<string, unknown>
  const metrics: Partial<Record<WebVitalName, number>> = {}
  const input = body.metrics
  if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const [name, value] of Object.entries(input as Record<string, unknown>)) {
      if (!isReportedVital(name)) continue
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > WEB_VITAL_LIMITS[name]) continue
      metrics[name] = name === "CLS" ? Math.round(value * 1000) / 1000 : Math.round(value)
    }
  }
  if (Object.keys(metrics).length === 0) return null
  const beacon: WebVitalsBeacon = { route: normalizeVitalsRoute(body.route), metrics }
  if (typeof body.conn === "string" && CONNECTION_TYPES.has(body.conn)) beacon.conn = body.conn
  if (typeof body.mem === "number" && Number.isFinite(body.mem) && body.mem > 0 && body.mem <= 64) beacon.mem = body.mem
  if (typeof body.cpu === "number" && Number.isInteger(body.cpu) && body.cpu > 0 && body.cpu <= 256) beacon.cpu = body.cpu
  return beacon
}

export function webVitalsLogLine(beacon: WebVitalsBeacon): string {
  return JSON.stringify({ evt: "web_vital", route: beacon.route, ...beacon.metrics, conn: beacon.conn, mem: beacon.mem, cpu: beacon.cpu })
}
