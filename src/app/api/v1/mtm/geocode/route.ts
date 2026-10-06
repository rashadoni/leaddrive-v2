import { NextResponse } from "next/server"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import { checkRateLimit } from "@/lib/rate-limit"
import {
  GEOCODE_QUERY_MAX,
  GEOCODE_QUERY_MIN,
  geocodeAddress,
  isValidCoordinate,
} from "@/lib/mtm/geocode"

const LANGUAGES = ["az", "ru", "en"] as const
const RATE_LIMIT = { maxRequests: 20, windowMs: 60_000 }

/**
 * GET /api/v1/mtm/geocode?q=…&lat=…&lng=…&lang=…
 *
 * Address search for the organization's location picker: a typed address in,
 * up to five candidate points out. It reads and writes nothing of the tenant —
 * the manager picks a point, corrects it on the map, and the organization's
 * own form saves it. Web sessions only; the field app has the phone's GPS.
 */
export const GET = withRouteFieldWebRlsAuth("read", async (req, auth) => {
  const params = new URL(req.url).searchParams
  const query = (params.get("q") ?? "").trim().replace(/\s+/g, " ")
  if (query.length < GEOCODE_QUERY_MIN || query.length > GEOCODE_QUERY_MAX) {
    return NextResponse.json(
      { error: `Address must be ${GEOCODE_QUERY_MIN}–${GEOCODE_QUERY_MAX} characters`, code: "MTM_GEOCODE_QUERY_INVALID" },
      { status: 400 },
    )
  }

  if (!checkRateLimit(`mtm-geocode:${auth.orgId}:${auth.userId}`, RATE_LIMIT)) {
    return NextResponse.json(
      { error: "Too many address searches. Try again in a minute.", code: "MTM_GEOCODE_RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": "60" } },
    )
  }

  const latitude = params.has("lat") ? Number(params.get("lat")) : NaN
  const longitude = params.has("lng") ? Number(params.get("lng")) : NaN
  const requestedLanguage = (params.get("lang") ?? "").toLowerCase().slice(0, 2)
  const language = LANGUAGES.find((candidate) => candidate === requestedLanguage) ?? "en"

  const result = await geocodeAddress({
    query,
    language,
    near: isValidCoordinate(latitude, longitude) ? { latitude, longitude } : null,
  })
  if (!result.ok) {
    return NextResponse.json(
      { error: "Address search is unavailable right now", code: "MTM_GEOCODE_UNAVAILABLE" },
      { status: 502 },
    )
  }
  return NextResponse.json({ success: true, data: { results: result.hits } })
})
