import { NextResponse } from "next/server"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import { checkRateLimit } from "@/lib/rate-limit"
import { isValidCoordinate, reverseGeocode } from "@/lib/mtm/geocode"

const LANGUAGES = ["az", "ru", "en"] as const
// The pin is dragged more often than an address is typed; still one person.
const RATE_LIMIT = { maxRequests: 30, windowMs: 60_000 }

/**
 * GET /api/v1/mtm/geocode/reverse?lat=…&lng=…&lang=…
 *
 * The address under the pin of the organization's location picker, so the
 * manager can write it into the card after moving the pin. Reads and writes
 * nothing of the tenant; the card's own form saves what the manager accepts.
 */
export const GET = withRouteFieldWebRlsAuth("read", async (req, auth) => {
  const params = new URL(req.url).searchParams
  const latitude = params.has("lat") ? Number(params.get("lat")) : NaN
  const longitude = params.has("lng") ? Number(params.get("lng")) : NaN
  if (!isValidCoordinate(latitude, longitude)) {
    return NextResponse.json(
      { error: "A valid latitude and longitude are required", code: "MTM_GEOCODE_POINT_INVALID" },
      { status: 400 },
    )
  }

  if (!checkRateLimit(`mtm-geocode-reverse:${auth.orgId}:${auth.userId}`, RATE_LIMIT)) {
    return NextResponse.json(
      { error: "Too many address lookups. Try again in a minute.", code: "MTM_GEOCODE_RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": "60" } },
    )
  }

  const requestedLanguage = (params.get("lang") ?? "").toLowerCase().slice(0, 2)
  const language = LANGUAGES.find((candidate) => candidate === requestedLanguage) ?? "en"
  const result = await reverseGeocode({ latitude, longitude, language })
  if (!result.ok) {
    return NextResponse.json(
      { error: "Address lookup is unavailable right now", code: "MTM_GEOCODE_UNAVAILABLE" },
      { status: 502 },
    )
  }
  return NextResponse.json({ success: true, data: { place: result.place } })
})
