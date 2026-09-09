import { describe, expect, it, vi } from "vitest"
import {
  GOOGLE_ROUTES_ENDPOINT,
  GOOGLE_ROUTES_MAX_STOPS,
  GoogleRoutesProviderError,
  createGoogleRoutesProvider,
  resolveGoogleRoutesRuntimeConfig,
} from "@/lib/mtm/google-routes"
import { createMtmRouteTravelCalculationRequest } from "@/lib/mtm/route-travel"

function calculationRequest(pointCount = 3) {
  return createMtmRouteTravelCalculationRequest({
    routeId: "route-1",
    routeVersion: 4,
    points: Array.from({ length: pointCount }, (_, index) => ({
      id: `point-${index + 1}`,
      orderIndex: index + 1,
      latitude: 40.4 + index / 100,
      longitude: 49.8 + index / 100,
    })),
  })
}

describe("Google Routes adapter", () => {
  it("uses a minimal, order-preserving Compute Routes request without geometry, traffic, or optimization", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      routes: [{ duration: "321.6s", distanceMeters: 12345.4 }],
    }), { status: 200 }))
    const provider = createGoogleRoutesProvider({ apiKey: "server-only-key", fetchImpl })

    const result = await provider.calculate(calculationRequest())

    expect(fetchImpl).toHaveBeenCalledOnce()
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(GOOGLE_ROUTES_ENDPOINT)
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": "server-only-key",
        "x-goog-fieldmask": "routes.duration,routes.distanceMeters",
      },
    })
    expect(JSON.parse(init.body)).toEqual({
      origin: { location: { latLng: { latitude: 40.4, longitude: 49.8 } } },
      destination: { location: { latLng: { latitude: 40.42, longitude: 49.82 } } },
      intermediates: [{ location: { latLng: { latitude: 40.41, longitude: 49.809999999999995 } } }],
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_UNAWARE",
      computeAlternativeRoutes: false,
    })
    expect(result).toMatchObject({
      source: calculationRequest().source,
      provider: { key: "google-routes", resultVersion: "compute-routes-distance-duration-v1" },
      distanceMeters: 12345,
      durationSeconds: 322,
      geometry: null,
    })
  })

  it("rejects input outside the cost-safe stop cap before a provider request", async () => {
    const fetchImpl = vi.fn()
    const provider = createGoogleRoutesProvider({ apiKey: "server-only-key", fetchImpl })

    await expect(provider.calculate(calculationRequest(GOOGLE_ROUTES_MAX_STOPS + 1))).rejects.toMatchObject({
      code: "INPUT_INVALID",
    } satisfies Partial<GoogleRoutesProviderError>)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("turns upstream errors into a safe unavailable state without forwarding their body", async () => {
    const provider = createGoogleRoutesProvider({
      apiKey: "server-only-key",
      fetchImpl: vi.fn().mockResolvedValue(new Response("sensitive upstream diagnostics", { status: 429 })),
    })

    await expect(provider.calculate(calculationRequest())).rejects.toEqual(expect.objectContaining({
      name: "GoogleRoutesProviderError",
      code: "UNAVAILABLE",
      message: "Google Routes unavailable",
    }))
  })

  it("requires every process-level cost gate before exposing a runtime provider", () => {
    const enabled = {
      GOOGLE_MAPS_ROUTES_EXECUTION_ENABLED: "true",
      GOOGLE_MAPS_ROUTES_API_KEY: "server-only-key",
      GOOGLE_MAPS_ROUTES_ALLOWED_ORG_IDS: "org-1",
      GOOGLE_MAPS_ROUTES_DAILY_LIMIT: "12",
      GOOGLE_MAPS_ROUTES_TIMEOUT_MS: "7000",
    }

    expect(resolveGoogleRoutesRuntimeConfig("org-1", enabled)).toEqual({
      apiKey: "server-only-key",
      dailyLimit: 12,
      timeoutMs: 7000,
    })
    expect(resolveGoogleRoutesRuntimeConfig("org-3", enabled)).toBeNull()
    expect(resolveGoogleRoutesRuntimeConfig("org-1", { ...enabled, GOOGLE_MAPS_ROUTES_ALLOWED_ORG_IDS: "org-1,org-2" })).toBeNull()
    expect(resolveGoogleRoutesRuntimeConfig("org-1", { ...enabled, GOOGLE_MAPS_ROUTES_DAILY_LIMIT: "0" })).toBeNull()
    expect(resolveGoogleRoutesRuntimeConfig("org-1", { ...enabled, GOOGLE_MAPS_ROUTES_DAILY_LIMIT: "51" })).toBeNull()
    expect(resolveGoogleRoutesRuntimeConfig("org-1", { ...enabled, GOOGLE_MAPS_ROUTES_EXECUTION_ENABLED: "false" })).toBeNull()
  })
})
