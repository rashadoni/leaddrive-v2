import { describe, expect, it } from "vitest"
import {
  buildGoogleMapsDirectionsUrl,
  buildGoogleMapsEmbedDirectionsUrl,
  hasMtmGoogleMapCoordinate,
} from "@/lib/mtm/google-maps-urls"

describe("MTM Google Maps URLs", () => {
  it("accepts valid zero coordinates and refuses out-of-range values", () => {
    expect(hasMtmGoogleMapCoordinate({ latitude: 0, longitude: 0 })).toBe(true)
    expect(hasMtmGoogleMapCoordinate({ latitude: 91, longitude: 0 })).toBe(false)
    expect(buildGoogleMapsDirectionsUrl({ latitude: null, longitude: 49.8 })).toBeNull()
  })

  it("creates an explicit navigation deeplink without a provider calculation", () => {
    expect(buildGoogleMapsDirectionsUrl({ latitude: 40.4093, longitude: 49.8671 })).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=40.4093%2C49.8671&travelmode=driving",
    )
  })

  it("keeps the manually selected order in an isolated Google Maps Embed surface", () => {
    const url = buildGoogleMapsEmbedDirectionsUrl({
      apiKey: "public-referrer-key",
      language: "ru",
      region: "AZ",
      points: [
        { latitude: 40.4, longitude: 49.8 },
        { latitude: 40.5, longitude: 49.9 },
        { latitude: 40.6, longitude: 50 },
      ],
    })

    expect(url).toContain("https://www.google.com/maps/embed/v1/directions?")
    expect(url).toContain("origin=40.4%2C49.8")
    expect(url).toContain("waypoints=40.5%2C49.9")
    expect(url).toContain("destination=40.6%2C50")
    expect(url).toContain("mode=driving")
    expect(url).toContain("language=ru")
  })
})
