import { describe, expect, it } from "vitest"
import { brightDataRouteFor, validateBrightDataDatasetRoutes } from "@/lib/social/bright-data-client"
import {
  BRIGHT_DATA_SOCIAL_ROUTES,
  brightDataDiscoveryInputKind,
} from "@/lib/social/bright-data-social-routes"

describe("Bright Data social route registry", () => {
  it("has one valid route for every required capability on the first three platforms", () => {
    expect(() => validateBrightDataDatasetRoutes(BRIGHT_DATA_SOCIAL_ROUTES)).not.toThrow()
    for (const platform of ["instagram", "facebook", "tiktok"]) {
      for (const capability of [
        "DISCOVER_URLS",
        "ENRICH_CONTENT",
        "READ_COMMENTS",
        "READ_MEDIA",
        "UPDATE_METRICS",
      ] as const) {
        expect(brightDataRouteFor(BRIGHT_DATA_SOCIAL_ROUTES, platform, capability), `${platform}/${capability}`)
          .not.toBeNull()
      }
    }
  })

  it("models the actual discovery input instead of pretending Meta supports keyword search", () => {
    expect(brightDataDiscoveryInputKind("instagram")).toBe("PROFILE_URL")
    expect(brightDataDiscoveryInputKind("facebook")).toBe("PROFILE_URL")
    expect(brightDataDiscoveryInputKind("tiktok")).toBe("KEYWORD")
    expect(brightDataRouteFor(BRIGHT_DATA_SOCIAL_ROUTES, "instagram", "DISCOVER_URLS")).toMatchObject({
      operation: "DISCOVER",
      discoverBy: "url",
    })
    expect(brightDataRouteFor(BRIGHT_DATA_SOCIAL_ROUTES, "tiktok", "DISCOVER_URLS")).toMatchObject({
      operation: "DISCOVER",
      discoverBy: "keyword",
    })
  })
})
