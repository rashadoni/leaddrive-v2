#!/usr/bin/env node
import { pathToFileURL } from "node:url"
import { createInterface } from "node:readline"

const PREFIX = "[mtm-mobile-sync-telemetry]"
const MAX_LINES = 100_000
const MAX_LINE_BYTES = 65_536
const MAX_INPUT_BYTES = 32 * 1024 * 1024
const MAX_APK_BUCKETS = 20
const STREAMS = ["routes", "visits", "tasks", "workforce"]
const RESULTS = [
  "ok",
  "forbidden",
  "cohort_disabled",
  "invalid_request",
  "invalid_cursor",
  "resnapshot_required",
  "payload_too_large",
  "rate_limited",
  "unavailable",
]
const STREAM_SET = new Set(STREAMS)
const RESULT_SET = new Set(RESULTS)

function counter(keys) {
  return Object.fromEntries(keys.map((key) => [key, 0]))
}

function safeInteger(value, max) {
  return Number.isSafeInteger(value) && value >= 0 && value <= max
}

function safeApkVersion(value) {
  return value === "unknown" || (
    typeof value === "string"
    && /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:\+\d{1,10})?$/.test(value)
  )
}

function parseEvent(line, tenant) {
  if (typeof line !== "string" || Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) return null
  const offset = line.indexOf(PREFIX)
  if (offset < 0) return null
  let value
  try {
    value = JSON.parse(line.slice(offset + PREFIX.length).trim())
  } catch {
    return null
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  if (value.event !== "mobile_sync_pull" || value.tenant !== tenant) return null
  if (!STREAM_SET.has(value.stream) || !RESULT_SET.has(value.result)) return null
  if (value.endpoint !== `GET /api/v2/mtm/mobile/sync/${value.stream}`) return null
  if (value.contractVersion !== 1 && value.contractVersion !== 2) return null
  if (!safeApkVersion(value.apkVersion)) return null
  if (!safeInteger(value.rowCount, 10_000) || !safeInteger(value.payloadBytes, 2_000_000)) return null
  if (!safeInteger(value.durationMs, 300_000)) return null
  if (typeof value.successSampleRate !== "number" || value.successSampleRate < 0 || value.successSampleRate > 1) return null
  return {
    stream: value.stream,
    result: value.result,
    apkVersion: value.apkVersion,
    rowCount: value.rowCount,
    payloadBytes: value.payloadBytes,
    durationMs: value.durationMs,
  }
}

function percentile(values, ratio) {
  if (values.length === 0) return null
  const ordered = [...values].sort((a, b) => a - b)
  return ordered[Math.max(0, Math.ceil(ordered.length * ratio) - 1)]
}

export function summarizeWorkforceSyncTelemetry(lines, tenant) {
  if (!/^[a-f0-9]{16}$/.test(tenant)) throw new Error("tenant must be a 16-character telemetry pseudonym")
  const byStream = Object.fromEntries(STREAMS.map((stream) => [stream, {
    events: 0,
    rows: 0,
    payloadBytes: 0,
    durationMs: [],
    results: counter(RESULTS),
  }]))
  const apkCounts = new Map()
  let inspectedLines = 0
  let acceptedEvents = 0
  let discardedLines = 0
  let truncated = false

  for (const line of lines) {
    if (inspectedLines >= MAX_LINES) {
      truncated = true
      break
    }
    inspectedLines += 1
    const event = parseEvent(line, tenant)
    if (!event) {
      discardedLines += 1
      continue
    }
    acceptedEvents += 1
    const stream = byStream[event.stream]
    stream.events += 1
    stream.rows += event.rowCount
    stream.payloadBytes += event.payloadBytes
    stream.durationMs.push(event.durationMs)
    stream.results[event.result] += 1
    apkCounts.set(event.apkVersion, (apkCounts.get(event.apkVersion) ?? 0) + 1)
  }

  const apkVersions = [...apkCounts.entries()]
    .sort(([leftVersion, leftCount], [rightVersion, rightCount]) => (
      rightCount - leftCount || leftVersion.localeCompare(rightVersion)
    ))
  const retainedApkVersions = Object.fromEntries(apkVersions.slice(0, MAX_APK_BUCKETS))
  const otherApkEvents = apkVersions.slice(MAX_APK_BUCKETS)
    .reduce((total, [, count]) => total + count, 0)

  return {
    schemaVersion: 1,
    inspectedLines,
    acceptedEvents,
    discardedLines,
    truncated,
    byStream: Object.fromEntries(STREAMS.map((streamName) => {
      const stream = byStream[streamName]
      return [streamName, {
        events: stream.events,
        rows: stream.rows,
        payloadBytes: stream.payloadBytes,
        latencyMs: {
          p50: percentile(stream.durationMs, 0.5),
          p95: percentile(stream.durationMs, 0.95),
          p99: percentile(stream.durationMs, 0.99),
        },
        results: stream.results,
      }]
    })),
    apkVersions: retainedApkVersions,
    otherApkEvents,
  }
}

async function main() {
  const tenantIndex = process.argv.indexOf("--tenant")
  const tenant = tenantIndex >= 0 ? process.argv[tenantIndex + 1] : ""
  if (process.argv.length !== 4 || tenantIndex !== 2 || !/^[a-f0-9]{16}$/.test(tenant)) {
    throw new Error("usage: workforce-sync-diagnostics.mjs --tenant <16-hex-telemetry-pseudonym>")
  }
  const lines = []
  let inputBytes = 0
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of input) {
    inputBytes += Buffer.byteLength(line, "utf8")
    if (inputBytes > MAX_INPUT_BYTES) throw new Error("diagnostic input exceeds 32 MiB")
    lines.push(line)
    if (lines.length > MAX_LINES) break
  }
  process.stdout.write(`${JSON.stringify(summarizeWorkforceSyncTelemetry(lines, tenant), null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "diagnostic failed"}\n`)
    process.exitCode = 1
  })
}
