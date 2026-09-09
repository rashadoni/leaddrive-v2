import type {
  MtmRouteTravelCalculationRequest,
  MtmRouteTravelProvider,
  MtmRouteTravelProviderCalculation,
} from "@/lib/mtm/route-travel"

export const GOOGLE_ROUTES_PROVIDER_KEY = "google-routes" as const
export const GOOGLE_ROUTES_ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes"
export const GOOGLE_ROUTES_DEFAULT_TIMEOUT_MS = 5_000
export const GOOGLE_ROUTES_MAX_STOPS = 10
export const GOOGLE_ROUTES_PILOT_MAX_DAILY_LIMIT = 50
export const GOOGLE_ROUTES_RESULT_VERSION = "compute-routes-distance-duration-v1"

type FetchLike = typeof fetch
type GoogleRoutesEnvironment = Record<string, string | undefined>

export type GoogleRoutesRuntimeConfig = {
  apiKey: string
  dailyLimit: number
  timeoutMs: number
}

export type GoogleRoutesProviderConfig = {
  apiKey: string
  endpoint?: string
  timeoutMs?: number
  fetchImpl?: FetchLike
}

export class GoogleRoutesProviderError extends Error {
  constructor(public readonly code: "UNAVAILABLE" | "INVALID_RESPONSE" | "INPUT_INVALID") {
    super(`Google Routes ${code.toLowerCase()}`)
    this.name = "GoogleRoutesProviderError"
  }
}

/**
 * Resolve the production fence, not a client-visible configuration. All four
 * gates are required: explicit process enablement, an API key, a non-zero
 * daily ceiling, and an allowlisted tenant. This keeps an accidental tenant
 * setting or a leaked browser request from creating paid traffic.
 */
export function resolveGoogleRoutesRuntimeConfig(
  organizationId: string,
  env: GoogleRoutesEnvironment = process.env,
): GoogleRoutesRuntimeConfig | null {
  if (env.GOOGLE_MAPS_ROUTES_EXECUTION_ENABLED !== "true") return null

  const apiKey = env.GOOGLE_MAPS_ROUTES_API_KEY?.trim()
  const dailyLimit = parsePositiveInteger(
    env.GOOGLE_MAPS_ROUTES_DAILY_LIMIT,
    GOOGLE_ROUTES_PILOT_MAX_DAILY_LIMIT,
  )
  const allowedOrganizationIds = new Set(
    (env.GOOGLE_MAPS_ROUTES_ALLOWED_ORG_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  )

  if (
    !apiKey
    || !dailyLimit
    || allowedOrganizationIds.size !== 1
    || !allowedOrganizationIds.has(organizationId)
  ) return null

  return {
    apiKey,
    dailyLimit,
    timeoutMs: parseTimeout(env.GOOGLE_MAPS_ROUTES_TIMEOUT_MS) ?? GOOGLE_ROUTES_DEFAULT_TIMEOUT_MS,
  }
}

/**
 * Thin, server-only Google Routes adapter. It intentionally requests only
 * distance and duration: Route geometry is Google Maps content and must not
 * be copied onto the product's Leaflet/OSM map or durably stored.
 */
export function createGoogleRoutesProvider(config: GoogleRoutesProviderConfig): MtmRouteTravelProvider {
  const apiKey = config.apiKey.trim()
  if (!apiKey) throw new Error("Google Routes apiKey is required")

  const endpoint = config.endpoint ?? GOOGLE_ROUTES_ENDPOINT
  const timeoutMs = clampTimeout(config.timeoutMs)
  const fetchImpl = config.fetchImpl ?? fetch

  return {
    key: GOOGLE_ROUTES_PROVIDER_KEY,
    async calculate(input: MtmRouteTravelCalculationRequest): Promise<MtmRouteTravelProviderCalculation> {
      if (input.points.length < 2 || input.points.length > GOOGLE_ROUTES_MAX_STOPS) {
        throw new GoogleRoutesProviderError("INPUT_INVALID")
      }
      if (input.points.some((point) => !isValidCoordinate(point.latitude, point.longitude))) {
        throw new GoogleRoutesProviderError("INPUT_INVALID")
      }

      const origin = input.points[0]
      const destination = input.points[input.points.length - 1]
      const intermediates = input.points.slice(1, -1)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)

      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": apiKey,
            // Keep the response minimal and avoid geometry/traffic/optimization
            // content until the owner approves a separately compliant surface.
            "x-goog-fieldmask": "routes.duration,routes.distanceMeters",
          },
          body: JSON.stringify({
            origin: waypoint(origin.latitude, origin.longitude),
            destination: waypoint(destination.latitude, destination.longitude),
            ...(intermediates.length > 0
              ? { intermediates: intermediates.map((point) => waypoint(point.latitude, point.longitude)) }
              : {}),
            travelMode: "DRIVE",
            routingPreference: "TRAFFIC_UNAWARE",
            computeAlternativeRoutes: false,
          }),
          signal: controller.signal,
        })

        if (!response.ok) throw new GoogleRoutesProviderError("UNAVAILABLE")
        const payload = await response.json().catch(() => null) as GoogleRoutesResponse | null
        const route = payload?.routes?.[0]
        const distanceMeters = route?.distanceMeters
        const durationSeconds = parseDurationSeconds(route?.duration)
        if (
          typeof distanceMeters !== "number"
          || !Number.isFinite(distanceMeters)
          || distanceMeters < 0
          || durationSeconds === null
        ) {
          throw new GoogleRoutesProviderError("INVALID_RESPONSE")
        }

        return {
          schemaVersion: input.schemaVersion,
          source: input.source,
          provider: {
            key: GOOGLE_ROUTES_PROVIDER_KEY,
            resultVersion: GOOGLE_ROUTES_RESULT_VERSION,
          },
          distanceMeters: Math.round(distanceMeters),
          durationSeconds,
          geometry: null,
        }
      } catch (error) {
        if (error instanceof GoogleRoutesProviderError) throw error
        // Deliberately do not forward an upstream exception body/message. It
        // may contain request diagnostics and must never disclose credentials.
        throw new GoogleRoutesProviderError("UNAVAILABLE")
      } finally {
        clearTimeout(timeout)
      }
    },
  }
}

type GoogleRoutesResponse = {
  routes?: Array<{
    duration?: string
    distanceMeters?: number
  }>
}

function waypoint(latitude: number, longitude: number) {
  return { location: { latLng: { latitude, longitude } } }
}

function isValidCoordinate(latitude: number, longitude: number) {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180
}

function parseDurationSeconds(value: string | undefined): number | null {
  const match = /^([0-9]+(?:\.[0-9]+)?)s$/.exec(value ?? "")
  if (!match) return null
  const seconds = Number(match[1])
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds) : null
}

function clampTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) return GOOGLE_ROUTES_DEFAULT_TIMEOUT_MS
  return Math.min(Math.max(Math.round(value!), 1_000), 10_000)
}

function parseTimeout(value: string | undefined): number | null {
  const parsed = parsePositiveInteger(value)
  return parsed ? clampTimeout(parsed) : null
}

function parsePositiveInteger(value: string | undefined, maximum = 10_000): number | null {
  if (!value || !/^[1-9][0-9]*$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : null
}
