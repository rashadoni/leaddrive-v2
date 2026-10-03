// Trusted environment control for the two immutable application trees. Keep
// timers monotonic; normalize Date-based business rules to the common fixture
// clock without editing either historical or current application source.
const NativeDate = Date
// Node's --require bootstrap is intentionally CommonJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("node:fs")
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path")
const anchor = process.env.SUPPORT_HISTORICAL_ANCHOR
if (process.env.CI !== "true" || process.env.GITHUB_ACTIONS !== "true" || process.env.RUNNER_ENVIRONMENT !== "github-hosted" || process.env.SUPPORT_HISTORICAL_BASE_URL !== "http://localhost:3000" || !/^\d{4}-\d{2}-\d{2}T08:00:00\.000Z$/.test(anchor || "") || !Number.isFinite(NativeDate.parse(anchor)) || new NativeDate(anchor).toISOString() !== anchor) {
  throw new Error("EPHEMERAL_CLOCK_REQUIRED")
}
const anchorMs = NativeDate.parse(anchor)
if (NativeDate.now() + 600000 >= anchorMs + 8 * 3600000) throw new Error("EPHEMERAL_COOKIE_CLOCK_EXPIRED")
const temp = process.env.RUNNER_TEMP
const proof = process.env.SUPPORT_HISTORICAL_CLOCK_PROOF
if (!temp || !proof || !path.isAbsolute(temp) || !path.isAbsolute(proof) || path.dirname(proof) !== fs.realpathSync(temp) || !/^support-historical-clock-(before|after)\.json$/.test(path.basename(proof))) throw new Error("EPHEMERAL_CLOCK_PROOF_REQUIRED")
const policy = "shared-future-utc-day-browser-server-anchor-with-monotonic-runtime-v1"
let bootstrap
if (fs.existsSync(proof)) {
  const raw = fs.readFileSync(proof, "utf8")
  if (raw.length > 1024) throw new Error("EPHEMERAL_CLOCK_PROOF_REQUIRED")
  bootstrap = JSON.parse(raw)
  if (Object.keys(bootstrap).sort().join(",") !== "anchor,clockPolicy,dateNow,nativeStartedAt,schemaVersion" || bootstrap.schemaVersion !== 1 || bootstrap.clockPolicy !== policy || bootstrap.anchor !== anchor || bootstrap.dateNow !== anchorMs || !Number.isFinite(bootstrap.nativeStartedAt) || bootstrap.nativeStartedAt > NativeDate.now() || bootstrap.nativeStartedAt < NativeDate.now() - 600000) throw new Error("EPHEMERAL_CLOCK_PROOF_REQUIRED")
} else {
  bootstrap = { schemaVersion: 1, clockPolicy: policy, anchor, dateNow: anchorMs, nativeStartedAt: NativeDate.now() }
  fs.writeFileSync(proof, JSON.stringify(bootstrap) + "\n", { mode: 0o600, flag: "wx" })
}
const started = process.hrtime.bigint()
const initialElapsed = NativeDate.now() - bootstrap.nativeStartedAt
const now = () => anchorMs + initialElapsed + Number((process.hrtime.bigint() - started) / 1000000n)
function HistoricalDate(...args) {
  if (!new.target) return new NativeDate(now()).toString()
  return Reflect.construct(NativeDate, args.length ? args : [now()], new.target)
}
Object.setPrototypeOf(HistoricalDate, NativeDate)
HistoricalDate.prototype = NativeDate.prototype
HistoricalDate.now = now
globalThis.Date = HistoricalDate
