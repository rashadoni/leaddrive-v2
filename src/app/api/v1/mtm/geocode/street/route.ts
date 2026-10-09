import { NextResponse } from "next/server"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import { checkRateLimit } from "@/lib/rate-limit"
import { isValidCoordinate } from "@/lib/mtm/geocode"
import { nearestStreet } from "@/lib/mtm/nearest-street"

// One selected employee, asked again only after he has moved: a few a minute at most.
const RATE_LIMIT = { maxRequests: 60, windowMs: 60_000 }

/**
 * GET /api/v1/mtm/geocode/street?lat=…&lng=…
 *
 * The street the selected employee is on, for the live map's card. Answered
 * by the company's own road server (src/lib/mtm/nearest-street.ts): the
 * coordinate is not sent to a public address service. Reads and writes
 * nothing of the tenant.
 *
 * `available: false` — the road server did not answer; the card then shows
 * no street rather than a guess.
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

  if (!checkRateLimit(`mtm-geocode-street:${auth.orgId}:${auth.userId}`, RATE_LIMIT)) {
    return NextResponse.json(
      { error: "Too many street lookups. Try again in a minute.", code: "MTM_GEOCODE_RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": "60" } },
    )
  }

  const result = await nearestStreet({ latitude, longitude })
  return NextResponse.json({
    success: true,
    data: result.ok
      ? { available: true, street: result.street, distanceMeters: result.distanceMeters }
      : { available: false, street: null, distanceMeters: null },
  })
})
