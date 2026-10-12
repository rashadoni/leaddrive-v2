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
): CustomerLocationRequestVerdict {
  const { proposed, agent } = input
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
  if (moved !== null && moved < LOCATION_REQUEST_MIN_MOVE_METERS) {
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
  stored: { customerId: string; proposedLatitude: number; proposedLongitude: number },
  customerId: string,
  proposed: { latitude: number; longitude: number },
): boolean {
  return stored.customerId === customerId
    && sameCoordinate(stored.proposedLatitude, proposed.latitude)
    && sameCoordinate(stored.proposedLongitude, proposed.longitude)
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
  },
  agentId: string,
) {
  const mine = request.requestedByAgentId === agentId
  return {
    id: request.id,
    status: request.status,
    mine,
    proposedLatitude: request.proposedLatitude,
    proposedLongitude: request.proposedLongitude,
    movedMeters: request.movedMeters,
    // What a manager wrote is for whoever asked.
    decisionComment: mine ? request.decisionComment : null,
    submittedAt: request.submittedAt.toISOString(),
    reviewedAt: request.reviewedAt ? request.reviewedAt.toISOString() : null,
  }
}

/** How long the answer to a request stays on the customer's card in the field app. */
export const LOCATION_REQUEST_ANSWER_SHOWN_DAYS = 7
