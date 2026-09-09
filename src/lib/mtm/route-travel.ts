import { createHash } from "node:crypto"

/**
 * This contract is deliberately provider-neutral. A route remains editable
 * while no external map/ETA provider is approved or while one is unavailable.
 * A later provider implementation must return a calculation for the exact
 * source fingerprint it received; it must never reorder the route itself.
 */
export const MTM_ROUTE_TRAVEL_SCHEMA_VERSION = 1 as const
export const MTM_ROUTE_TRAVEL_POLICY_VERSION = 1 as const
export const MTM_ROUTE_TRAVEL_PROVIDER_NOT_CONFIGURED = "MTM_ROUTE_TRAVEL_PROVIDER_NOT_CONFIGURED" as const

export type MtmRouteTravelProviderKey = "google-routes"

export type MtmRouteTravelPointInput = {
  id: string
  orderIndex: number
  latitude: number | null
  longitude: number | null
}

export type MtmRouteTravelSource = {
  routeId: string
  routeVersion: number
  fingerprint: string
  orderedPointIds: string[]
}

export type MtmRouteTravelCoordinateCoverage = {
  totalPoints: number
  locatedPoints: number
  missingPoints: number
}

export type MtmRouteTravelCalculationRequest = {
  schemaVersion: typeof MTM_ROUTE_TRAVEL_SCHEMA_VERSION
  source: MtmRouteTravelSource
  points: Array<{
    id: string
    orderIndex: number
    latitude: number
    longitude: number
  }>
}

export type MtmRouteTravelProviderCalculation = {
  schemaVersion: typeof MTM_ROUTE_TRAVEL_SCHEMA_VERSION
  source: MtmRouteTravelSource
  provider: {
    key: string
    resultVersion: string
  }
  distanceMeters: number
  durationSeconds: number
  geometry: {
    type: "LineString"
    coordinates: Array<[longitude: number, latitude: number]>
  } | null
}

/**
 * A provider may calculate geometry and travel time, but it has no authority
 * to persist, publish, or reorder a route. Those actions stay in the existing
 * route aggregate and its canonical state machine.
 */
export interface MtmRouteTravelProvider {
  readonly key: string
  calculate(input: MtmRouteTravelCalculationRequest): Promise<MtmRouteTravelProviderCalculation>
}

export type MtmRouteTravelPolicy = {
  schemaVersion: typeof MTM_ROUTE_TRAVEL_SCHEMA_VERSION
  policyVersion: typeof MTM_ROUTE_TRAVEL_POLICY_VERSION
  /** A provider can be ready without changing a route or its manual order. */
  state: "NOT_CONFIGURED" | "READY"
  providerKey: MtmRouteTravelProviderKey | null
  calculationEnabled: boolean
  navigationEnabled: boolean
}

export type MtmRouteTravelNotConfiguredPlan = {
  schemaVersion: typeof MTM_ROUTE_TRAVEL_SCHEMA_VERSION
  state: "NOT_CONFIGURED"
  reasonCode: typeof MTM_ROUTE_TRAVEL_PROVIDER_NOT_CONFIGURED
  provider: null
  source: MtmRouteTravelSource
  coordinateCoverage: MtmRouteTravelCoordinateCoverage
  manualOrder: {
    preserved: true
    orderedPointIds: string[]
  }
  calculation: {
    distanceMeters: null
    durationSeconds: null
    geometry: null
    calculatedAt: null
  }
}

/** A provider is ready, but no provider result has been requested or stored. */
export type MtmRouteTravelReadyPlan = {
  schemaVersion: typeof MTM_ROUTE_TRAVEL_SCHEMA_VERSION
  state: "READY"
  provider: {
    key: MtmRouteTravelProviderKey
  }
  source: MtmRouteTravelSource
  coordinateCoverage: MtmRouteTravelCoordinateCoverage
  manualOrder: {
    preserved: true
    orderedPointIds: string[]
  }
  calculation: {
    distanceMeters: null
    durationSeconds: null
    geometry: null
    calculatedAt: null
  }
}

export type MtmRouteTravelPlan = MtmRouteTravelNotConfiguredPlan | MtmRouteTravelReadyPlan

function hasValidCoordinate(point: MtmRouteTravelPointInput): point is MtmRouteTravelPointInput & {
  latitude: number
  longitude: number
} {
  return Number.isFinite(point.latitude)
    && Number.isFinite(point.longitude)
    && point.latitude !== null
    && point.longitude !== null
    && point.latitude >= -90
    && point.latitude <= 90
    && point.longitude >= -180
    && point.longitude <= 180
}

function orderedPoints(points: readonly MtmRouteTravelPointInput[]) {
  return [...points].sort((left, right) => left.orderIndex - right.orderIndex || left.id.localeCompare(right.id))
}

/**
 * The fallback policy is intentionally unconfigured until a tenant has opted
 * in AND the operator has supplied the server-side provider/cost guard. A
 * tenant setting alone can never enable an external call.
 */
export function resolveMtmRouteTravelPolicy(input: {
  tenantCalculationEnabled?: boolean
  tenantNavigationEnabled?: boolean
  providerKey?: MtmRouteTravelProviderKey | null
} = {}): MtmRouteTravelPolicy {
  const providerKey = input.tenantCalculationEnabled === true ? input.providerKey ?? null : null
  return {
    schemaVersion: MTM_ROUTE_TRAVEL_SCHEMA_VERSION,
    policyVersion: MTM_ROUTE_TRAVEL_POLICY_VERSION,
    state: providerKey ? "READY" : "NOT_CONFIGURED",
    providerKey,
    calculationEnabled: providerKey !== null,
    // A navigation deeplink is still tenant-controlled and explicit. It does
    // not grant permission to calculate, publish, or reorder a route.
    navigationEnabled: input.tenantNavigationEnabled === true,
  }
}

export function createMtmRouteTravelCalculationRequest(input: {
  routeId: string
  routeVersion: number
  points: readonly MtmRouteTravelPointInput[]
}): MtmRouteTravelCalculationRequest {
  const ordered = orderedPoints(input.points)
  const normalizedPoints = ordered.map((point) => ({
    id: point.id,
    orderIndex: point.orderIndex,
    latitude: hasValidCoordinate(point) ? point.latitude : null,
    longitude: hasValidCoordinate(point) ? point.longitude : null,
  }))
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({
      schemaVersion: MTM_ROUTE_TRAVEL_SCHEMA_VERSION,
      routeId: input.routeId,
      routeVersion: input.routeVersion,
      points: normalizedPoints,
    }))
    .digest("hex")

  return {
    schemaVersion: MTM_ROUTE_TRAVEL_SCHEMA_VERSION,
    source: {
      routeId: input.routeId,
      routeVersion: input.routeVersion,
      fingerprint: `sha256:${fingerprint}`,
      orderedPointIds: ordered.map((point) => point.id),
    },
    points: normalizedPoints.filter((point): point is MtmRouteTravelCalculationRequest["points"][number] => (
      point.latitude !== null && point.longitude !== null
    )),
  }
}

export function createMtmRouteTravelNotConfiguredPlan(input: {
  routeId: string
  routeVersion: number
  points: readonly MtmRouteTravelPointInput[]
}): MtmRouteTravelNotConfiguredPlan {
  const request = createMtmRouteTravelCalculationRequest(input)
  const coordinateCoverage = {
    totalPoints: input.points.length,
    locatedPoints: request.points.length,
    missingPoints: input.points.length - request.points.length,
  }

  return {
    schemaVersion: MTM_ROUTE_TRAVEL_SCHEMA_VERSION,
    state: "NOT_CONFIGURED",
    reasonCode: MTM_ROUTE_TRAVEL_PROVIDER_NOT_CONFIGURED,
    provider: null,
    source: request.source,
    coordinateCoverage,
    manualOrder: {
      preserved: true,
      orderedPointIds: request.source.orderedPointIds,
    },
    calculation: {
      distanceMeters: null,
      durationSeconds: null,
      geometry: null,
      calculatedAt: null,
    },
  }
}

/**
 * Detail reads expose whether a calculation can be explicitly requested. They
 * never restore a former provider response: Google route content is transient
 * and intentionally not persisted with the business route aggregate.
 */
export function createMtmRouteTravelPlan(input: {
  routeId: string
  routeVersion: number
  points: readonly MtmRouteTravelPointInput[]
  policy: MtmRouteTravelPolicy
}): MtmRouteTravelPlan {
  if (!input.policy.calculationEnabled || !input.policy.providerKey) {
    return createMtmRouteTravelNotConfiguredPlan(input)
  }

  const request = createMtmRouteTravelCalculationRequest(input)
  return {
    schemaVersion: MTM_ROUTE_TRAVEL_SCHEMA_VERSION,
    state: "READY",
    provider: { key: input.policy.providerKey },
    source: request.source,
    coordinateCoverage: {
      totalPoints: input.points.length,
      locatedPoints: request.points.length,
      missingPoints: input.points.length - request.points.length,
    },
    manualOrder: {
      preserved: true,
      orderedPointIds: request.source.orderedPointIds,
    },
    calculation: {
      distanceMeters: null,
      durationSeconds: null,
      geometry: null,
      calculatedAt: null,
    },
  }
}
