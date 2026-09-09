/**
 * GET /api/v1/timezones
 *
 * Catalog of curated IANA timezones with current GMT offset labels for the
 * Settings → Profile UI dropdown. Static data, lightweight, no DB hit.
 *
 * Response: { timezones: [{ key: "Europe/Warsaw", label: "Europe/Warsaw (GMT+02:00)", offsetMinutes: 120 }, ...] }
 *
 * Part of P5 Time zones per user.
 */
import { NextResponse } from "next/server"
import { withRls } from "@/lib/with-rls"
import { COMMON_TIMEZONES, getOffsetMinutes, timezoneLabel } from "@/lib/timezone"

/**
 * Cached payload — computed once per process start. 88 × Intl.DateTimeFormat
 * constructions is too expensive to run per request (DoS surface). Offsets
 * drift twice a year on DST boundaries, so we also expire daily; in practice
 * the LeadDrive PM2 process restarts more often than that on deploy.
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24h
let cachedAt = 0
let cached: { key: string; label: string; offsetMinutes: number }[] = []

function getTimezonesPayload() {
  const now = Date.now()
  if (cached.length > 0 && now - cachedAt < CACHE_TTL_MS) return cached
  const at = new Date(now)
  cached = COMMON_TIMEZONES.map(tz => ({
    key: tz,
    label: timezoneLabel(tz, at),
    offsetMinutes: getOffsetMinutes(tz, at),
  }))
  cachedAt = now
  return cached
}

export const GET = withRls(async (_req, { orgId }) => {
  return NextResponse.json({ timezones: getTimezonesPayload() })
})
