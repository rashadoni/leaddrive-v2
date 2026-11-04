import { calculateDistance } from "@/lib/geo-utils"
import { normalizeMtmCoordinates, type MtmCoordinateInput } from "@/lib/mtm/geo-coordinates"

/**
 * «Клиент здесь»: a field agent who has come to a customer and finds its pin
 * in the wrong place asks, from the spot, for the pin to be moved.
 *
 * The owner, 2026-10-12: «при добавлении адресов клиентов адрес может быть не
 * верным; агент приходит на тот адрес, но видит, что не те координаты. У него
 * должна быть возможность отправить запрос на корректировку, отправляя с места,
 * где клиент, координаты».
 *
 * The agent never changes a customer himself (owner, 2026-10-02): what he sends
 * is a question, and a manager accepts the new place or leaves the old one.
 * The rules below are what makes the question worth a manager's time — and
 * what keeps it from being a way to move a customer's pin to wherever an agent
 * would like visits to count:
 *
 *  - the phone must know where it is (accuracy), and must be asked now, not
 *    quote a place it was at earlier (age of the fix);
 *  - a place the phone was told to report (a mock provider) is not a place;
 *  - the new pin is where the agent stands, give or take the entrance round
 *    the corner — not another street;
 *  - a pin that is already there is not corrected.
 *
 * Pure: the routes read and write, this decides.
 */

/** How unsure of itself the phone may be and still be believed about where a customer is. */
export const LOCATION_REQUEST_MAX_ACCURACY_METERS = 100
/** How far from where he stands the agent may put the pin. */
export const LOCATION_REQUEST_MAX_PIN_FROM_AGENT_METERS = 150
/** A pin already this close to the proposed place is where it should be. */
export const LOCATION_REQUEST_MIN_MOVE_METERS = 20
/**
 * How old the phone's fix may be when the request is sent. Counted by the
 * phone itself — «this fix is N seconds old» — so that a phone whose clock is
 * an hour wrong is neither refused nor believed about a place it left.
 */
export const LOCATION_REQUEST_MAX_FIX_AGE_SECONDS = 120
export const LOCATION_REQUEST_COMMENT_MAX = 300

export type CustomerLocationRequestProblem = "mock" | "accuracy" | "stale" | "pinTooFar" | "unchanged"

/** The code a refusal carries; the field app has a sentence for each. */
export const CUSTOMER_LOCATION_REQUEST_ERROR: Record<CustomerLocationRequestProblem, string> = {
  mock: "MTM_LOCATION_REQUEST_MOCK_LOCATION",
  accuracy: "MTM_LOCATION_REQUEST_ACCURACY_TOO_LOW",
  stale: "MTM_LOCATION_REQUEST_FIX_TOO_OLD",
  pinTooFar: "MTM_LOCATION_REQUEST_PIN_TOO_FAR",
  unchanged: "MTM_LOCATION_REQUEST_UNCHANGED",
}
export const MTM_LOCATION_REQUEST_PENDING = "MTM_LOCATION_REQUEST_PENDING"
export const MTM_LOCATION_REQUEST_NOT_FOUND = "MTM_LOCATION_REQUEST_NOT_FOUND"
export const MTM_LOCATION_REQUEST_IDEMPOTENCY_MISMATCH = "MTM_LOCATION_REQUEST_IDEMPOTENCY_MISMATCH"
/** The customer's pin is no longer where it stood when the agent asked: somebody moved it meanwhile. */
export const MTM_LOCATION_REQUEST_CUSTOMER_MOVED = "MTM_LOCATION_REQUEST_CUSTOMER_MOVED"

export interface CustomerLocationRequestInput {
  proposed: { latitude: number; longitude: number }
  agent: { latitude: number; longitude: number; accuracyMeters: number; fixAgeSeconds: number; isMock?: boolean | null }
}

export interface CustomerLocationRequestFacts {
  previousLatitude: number | null
  previousLongitude: number | null
  proposedLatitude: number
  proposedLongitude: number
  agentLatitude: number
  agentLongitude: number
  agentAccuracyMeters: number
  agentFixAt: Date
  /** How far the pin would move; null when the customer has no pin yet. */
  movedMeters: number | null
  agentToProposedMeters: number
}

export type CustomerLocationRequestVerdict =
  | { ok: true; facts: CustomerLocationRequestFacts }
  | { ok: false; problem: CustomerLocationRequestProblem; details: Record<string, number> }

/**
 * Decides whether what the phone sent is a question a manager should see.
 * `customer` is the pin as it stands now; `now` is the server's clock.
 */
export function evaluateCustomerLocationRequest(
  input: CustomerLocationRequestInput,
  customer: MtmCoordinateInput,
  now: Date,
  options: { addressChanged?: boolean } = {},
): CustomerLocationRequestVerdict {
  const { agent } = input
  const proposed = effectiveProposedPoint(input.proposed, customer, options.addressChanged === true)
  // Android says so itself; a phone that does not say is not accused.
  if (agent.isMock === true) return { ok: false, problem: "mock", details: {} }
  if (agent.accuracyMeters > LOCATION_REQUEST_MAX_ACCURACY_METERS) {
    return {
      ok: false,
      problem: "accuracy",
      details: { accuracyMeters: Math.round(agent.accuracyMeters), maxAccuracyMeters: LOCATION_REQUEST_MAX_ACCURACY_METERS },
    }
  }
  if (agent.fixAgeSeconds > LOCATION_REQUEST_MAX_FIX_AGE_SECONDS) {
    return {
      ok: false,
      problem: "stale",
      details: { fixAgeSeconds: Math.round(agent.fixAgeSeconds), maxFixAgeSeconds: LOCATION_REQUEST_MAX_FIX_AGE_SECONDS },
    }
  }
  const agentToProposed = calculateDistance(agent.latitude, agent.longitude, proposed.latitude, proposed.longitude)
  if (agentToProposed > LOCATION_REQUEST_MAX_PIN_FROM_AGENT_METERS) {
    return {
      ok: false,
      problem: "pinTooFar",
      details: { distanceMeters: Math.round(agentToProposed), maxDistanceMeters: LOCATION_REQUEST_MAX_PIN_FROM_AGENT_METERS },
    }
  }
  const previous = normalizeMtmCoordinates(customer)
  const moved = previous.latitude === null || previous.longitude === null
    ? null
    : calculateDistance(previous.latitude, previous.longitude, proposed.latitude, proposed.longitude)
  if (moved !== null && moved < LOCATION_REQUEST_MIN_MOVE_METERS && options.addressChanged !== true) {
    return {
      ok: false,
      problem: "unchanged",
      details: { distanceMeters: Math.round(moved), minDistanceMeters: LOCATION_REQUEST_MIN_MOVE_METERS },
    }
  }
  return {
    ok: true,
    facts: {
      previousLatitude: previous.latitude,
      previousLongitude: previous.longitude,
      proposedLatitude: proposed.latitude,
      proposedLongitude: proposed.longitude,
      agentLatitude: agent.latitude,
      agentLongitude: agent.longitude,
      agentAccuracyMeters: agent.accuracyMeters,
      agentFixAt: new Date(now.getTime() - Math.max(0, agent.fixAgeSeconds) * 1000),
      movedMeters: moved === null ? null : Math.round(moved),
      agentToProposedMeters: Math.round(agentToProposed),
    },
  }
}

/** How long an address the agent may write: a street and a house, not a letter. */
export const LOCATION_REQUEST_ADDRESS_MAX = 300

/** An address as words: trimmed, one space between them; nothing written is null. */
export function normalizeLocationRequestAddress(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null
  const words = value.replace(/\s+/g, " ").trim()
  return words || null
}

/**
 * The address the request proposes: what the agent wrote, if it says
 * something other than the card — null when he left it as it was. Case and
 * spacing are not a correction («nizami küç. 41» is the same street).
 */
export function proposedAddressChange(current: string | null | undefined, written: string | null | undefined): string | null {
  const proposed = normalizeLocationRequestAddress(written)
  if (!proposed) return null
  const now = normalizeLocationRequestAddress(current)
  if (now && now.toLocaleLowerCase() === proposed.toLocaleLowerCase()) return null
  return proposed
}

/**
 * Where the pin is proposed: where the agent put it — or, when the request is
 * about the address and the pin is within a few metres of where it stands,
 * where it stands. A finger that brushed the map is not a correction of the
 * pin, and a manager is not asked to move it by eight metres.
 */
export function effectiveProposedPoint(
  proposed: { latitude: number; longitude: number },
  customer: MtmCoordinateInput,
  addressChanged: boolean,
): { latitude: number; longitude: number } {
  if (!addressChanged) return proposed
  const previous = normalizeMtmCoordinates(customer)
  if (previous.latitude === null || previous.longitude === null) return proposed
  const moved = calculateDistance(previous.latitude, previous.longitude, proposed.latitude, proposed.longitude)
  return moved < LOCATION_REQUEST_MIN_MOVE_METERS ? { latitude: previous.latitude, longitude: previous.longitude } : proposed
}

export interface RemoteLocationRequestInput {
  proposed: { latitude: number; longitude: number }
  /** Where the phone was, if it knew: kept for the manager, never a condition. */
  agent?: { latitude: number; longitude: number; accuracyMeters: number; fixAgeSeconds: number; isMock?: boolean | null } | null
}

export interface RemoteLocationRequestFacts {
  previousLatitude: number | null
  previousLongitude: number | null
  proposedLatitude: number
  proposedLongitude: number
  agentLatitude: number | null
  agentLongitude: number | null
  agentAccuracyMeters: number | null
  agentFixAt: Date | null
  movedMeters: number | null
  agentToProposedMeters: number | null
}

/**
 * «Заранее» (owner, 2026-11-04): the agent sees before he goes that the
 * customer is no longer where the card says, and proposes the new place from
 * wherever he is. Nothing about where he stands is a condition — that is the
 * point of it — so such a request proves nothing about the place: it is
 * marked so for the manager, and until the agent confirms it standing there
 * (`evaluateLocationRequestConfirmation`) no visit counts from it.
 *
 * Refused only when it asks for nothing: the pin already there and the
 * address as it was.
 */
export function evaluateRemoteCustomerLocationRequest(
  input: RemoteLocationRequestInput,
  customer: MtmCoordinateInput,
  now: Date,
  options: { addressChanged?: boolean } = {},
): { ok: true; facts: RemoteLocationRequestFacts } | { ok: false; problem: "unchanged"; details: Record<string, number> } {
  const addressChanged = options.addressChanged === true
  const proposed = effectiveProposedPoint(input.proposed, customer, addressChanged)
  const previous = normalizeMtmCoordinates(customer)
  const moved = previous.latitude === null || previous.longitude === null
    ? null
    : calculateDistance(previous.latitude, previous.longitude, proposed.latitude, proposed.longitude)
  if (moved !== null && moved < LOCATION_REQUEST_MIN_MOVE_METERS && !addressChanged) {
    return {
      ok: false,
      problem: "unchanged",
      details: { distanceMeters: Math.round(moved), minDistanceMeters: LOCATION_REQUEST_MIN_MOVE_METERS },
    }
  }
  // A position the phone was told to report, or one it took long ago, says nothing: not kept.
  const agent = input.agent
    && input.agent.isMock !== true
    && input.agent.fixAgeSeconds <= LOCATION_REQUEST_MAX_FIX_AGE_SECONDS
    && normalizeMtmCoordinates(input.agent).latitude !== null
    ? input.agent
    : null
  return {
    ok: true,
    facts: {
      previousLatitude: previous.latitude,
      previousLongitude: previous.longitude,
      proposedLatitude: proposed.latitude,
      proposedLongitude: proposed.longitude,
      agentLatitude: agent?.latitude ?? null,
      agentLongitude: agent?.longitude ?? null,
      agentAccuracyMeters: agent?.accuracyMeters ?? null,
      agentFixAt: agent ? new Date(now.getTime() - Math.max(0, agent.fixAgeSeconds) * 1000) : null,
      movedMeters: moved === null ? null : Math.round(moved),
      agentToProposedMeters: agent ? Math.round(calculateDistance(agent.latitude, agent.longitude, proposed.latitude, proposed.longitude)) : null,
    },
  }
}

/** The agent is not at the place he proposed: he cannot say «клиент здесь» about it. */
export const MTM_LOCATION_REQUEST_CONFIRM_TOO_FAR = "MTM_LOCATION_REQUEST_CONFIRM_TOO_FAR"
/** No advance request of his waits about this customer, or it is confirmed already. */
export const MTM_LOCATION_REQUEST_NOTHING_TO_CONFIRM = "MTM_LOCATION_REQUEST_NOTHING_TO_CONFIRM"

export type LocationRequestConfirmationProblem = "mock" | "accuracy" | "stale" | "notHere"

export const LOCATION_REQUEST_CONFIRMATION_ERROR: Record<LocationRequestConfirmationProblem, string> = {
  mock: CUSTOMER_LOCATION_REQUEST_ERROR.mock,
  accuracy: CUSTOMER_LOCATION_REQUEST_ERROR.accuracy,
  stale: CUSTOMER_LOCATION_REQUEST_ERROR.stale,
  notHere: MTM_LOCATION_REQUEST_CONFIRM_TOO_FAR,
}

/**
 * «Пришёл уже на правильное место и подтверждает» (owner, 2026-11-04): the
 * agent who proposed a place in advance stands at it and says so. The same
 * conditions as «Клиент здесь» — the phone knows where it is, now, of itself,
 * and the agent is at the proposed pin, give or take the entrance round the
 * corner. Then the request is what an on-site one is: visits count from the
 * proposed place while it waits, and the manager reads «подтверждено на месте».
 */
export function evaluateLocationRequestConfirmation(
  request: { proposedLatitude: number; proposedLongitude: number },
  agent: CustomerLocationRequestInput["agent"],
  now: Date,
):
  | { ok: true; facts: { confirmedAt: Date; confirmLatitude: number; confirmLongitude: number; confirmAccuracyMeters: number; confirmToProposedMeters: number } }
  | { ok: false; problem: LocationRequestConfirmationProblem; details: Record<string, number> } {
  if (agent.isMock === true) return { ok: false, problem: "mock", details: {} }
  if (agent.accuracyMeters > LOCATION_REQUEST_MAX_ACCURACY_METERS) {
    return {
      ok: false,
      problem: "accuracy",
      details: { accuracyMeters: Math.round(agent.accuracyMeters), maxAccuracyMeters: LOCATION_REQUEST_MAX_ACCURACY_METERS },
    }
  }
  if (agent.fixAgeSeconds > LOCATION_REQUEST_MAX_FIX_AGE_SECONDS) {
    return {
      ok: false,
      problem: "stale",
      details: { fixAgeSeconds: Math.round(agent.fixAgeSeconds), maxFixAgeSeconds: LOCATION_REQUEST_MAX_FIX_AGE_SECONDS },
    }
  }
  const distance = calculateDistance(agent.latitude, agent.longitude, request.proposedLatitude, request.proposedLongitude)
  if (distance > LOCATION_REQUEST_MAX_PIN_FROM_AGENT_METERS) {
    return {
      ok: false,
      problem: "notHere",
      details: { distanceMeters: Math.round(distance), maxDistanceMeters: LOCATION_REQUEST_MAX_PIN_FROM_AGENT_METERS },
    }
  }
  return {
    ok: true,
    facts: {
      confirmedAt: new Date(now.getTime() - Math.max(0, agent.fixAgeSeconds) * 1000),
      confirmLatitude: agent.latitude,
      confirmLongitude: agent.longitude,
      confirmAccuracyMeters: agent.accuracyMeters,
      confirmToProposedMeters: Math.round(distance),
    },
  }
}

/**
 * Whether a request stands on a fix taken at the place: «Клиент здесь», or an
 * advance one the agent confirmed there. Only such a request lets a visit
 * count from the proposed place, and only its acceptance leaves a coordinate
 * receipt — one accepted on the agent's word alone moves the pin, but nobody
 * stood there to verify it.
 */
export function locationRequestMadeAtPlace(request: { origin?: string | null; confirmedAt?: Date | string | null }): boolean {
  return (request.origin ?? "ON_SITE") === "ON_SITE" || !!request.confirmedAt
}

/**
 * A coordinate that has been to the database and back may differ from the
 * number that was sent in its last digit (seen on a real Postgres:
 * 40.410791852151625 came back as 40.41079185215163). That is not another
 * place: two coordinates within this many degrees — about a tenth of a
 * millimetre — are the same one.
 */
export const SAME_COORDINATE_DEGREES = 1e-9

function sameCoordinate(one: number | null, other: number | null): boolean {
  if (one === null || other === null) return one === other
  return Math.abs(one - other) <= SAME_COORDINATE_DEGREES
}

/**
 * Two sendings with one key are one request only if they say the same thing:
 * the same customer and the same pin. (The phone's own position may differ by
 * a metre between a sending and its retry; the pin the agent chose may not.)
 */
export function sameCustomerLocationRequest(
  stored: { customerId: string; proposedLatitude: number; proposedLongitude: number; origin?: string | null; proposedAddress?: string | null },
  customerId: string,
  proposed: { latitude: number; longitude: number },
  // Known to the route: from where it was asked, and which address it proposes.
  also?: { origin: string; proposedAddress: string | null },
): boolean {
  return stored.customerId === customerId
    && sameCoordinate(stored.proposedLatitude, proposed.latitude)
    && sameCoordinate(stored.proposedLongitude, proposed.longitude)
    && (!also || ((stored.origin ?? "ON_SITE") === also.origin && (stored.proposedAddress ?? null) === also.proposedAddress))
}

/**
 * Is the pin still where it stood when the agent asked? A manager who accepts
 * a request moves the pin from THAT place; if somebody has moved it meanwhile,
 * the request describes a customer that no longer exists as it was.
 */
export function customerPinUnchangedSince(
  request: { previousLatitude: number | null; previousLongitude: number | null },
  customer: MtmCoordinateInput,
): boolean {
  const now = normalizeMtmCoordinates(customer)
  return sameCoordinate(now.latitude, request.previousLatitude) && sameCoordinate(now.longitude, request.previousLongitude)
}

/**
 * Is the address the agent corrects still what it was when he asked? A
 * request that does not touch the address is not stopped by a change to it.
 */
export function customerAddressUnchangedSince(
  request: { previousAddress?: string | null; proposedAddress?: string | null },
  customer: { address?: string | null },
): boolean {
  if (!request.proposedAddress) return true
  return normalizeLocationRequestAddress(request.previousAddress) === normalizeLocationRequestAddress(customer.address)
}

/** The pin and — when the request corrects it — the address, both as the agent saw them. */
export function customerPlaceUnchangedSince(
  request: { previousLatitude: number | null; previousLongitude: number | null; previousAddress?: string | null; proposedAddress?: string | null },
  customer: MtmCoordinateInput & { address?: string | null },
): boolean {
  return customerPinUnchangedSince(request, customer) && customerAddressUnchangedSince(request, customer)
}

/**
 * The same question put to the database, for the UPDATE that moves the pin:
 * «the row whose pin still stands where the agent saw it». A pin that was not
 * there matches only a pin that still is not.
 */
export function customerPinStillAt(request: { previousLatitude: number | null; previousLongitude: number | null }) {
  const axis = (value: number | null) => (value === null ? null : { gte: value - SAME_COORDINATE_DEGREES, lte: value + SAME_COORDINATE_DEGREES })
  return { latitude: axis(request.previousLatitude), longitude: axis(request.previousLongitude) }
}

/** What the field app is told about a request: its own, or the one that is waiting about this customer. */
export function customerLocationRequestForAgent(
  request: {
    id: string
    status: string
    requestedByAgentId: string
    proposedLatitude: number
    proposedLongitude: number
    movedMeters: number | null
    decisionComment: string | null
    submittedAt: Date
    reviewedAt: Date | null
    origin?: string | null
    proposedAddress?: string | null
    confirmedAt?: Date | null
  },
  agentId: string,
) {
  const mine = request.requestedByAgentId === agentId
  return {
    id: request.id,
    status: request.status,
    mine,
    // «Заранее» or «на месте», and whether the agent has since stood at it.
    origin: request.origin ?? "ON_SITE",
    confirmedAt: request.confirmedAt ? request.confirmedAt.toISOString() : null,
    proposedLatitude: request.proposedLatitude,
    proposedLongitude: request.proposedLongitude,
    proposedAddress: request.proposedAddress ?? null,
    movedMeters: request.movedMeters,
    // What a manager wrote is for whoever asked.
    decisionComment: mine ? request.decisionComment : null,
    submittedAt: request.submittedAt.toISOString(),
    reviewedAt: request.reviewedAt ? request.reviewedAt.toISOString() : null,
  }
}

/** How long the answer to a request stays on the customer's card in the field app. */
export const LOCATION_REQUEST_ANSWER_SHOWN_DAYS = 7
