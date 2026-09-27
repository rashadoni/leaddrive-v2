import {
  WORKFORCE_WORKDAY_CURRENT_SCHEMA_VERSION,
  WORKFORCE_WORKDAY_LEGACY_SCHEMA_VERSION,
} from "@/lib/mtm/workday"
import { WORKFORCE_EVIDENCE_ENVELOPE_VERSION } from "@/lib/workforce/evidence-envelope"

export const WORKFORCE_MOBILE_BOOTSTRAP_SCHEMA_VERSION = 1
export const WORKFORCE_WORKDAY_RESPONSE_SCHEMA_VERSION = 1
export const WORKFORCE_SITE_TRANSITION_CLAIM_SCHEMA_VERSION = 1

/**
 * Server-owned wire compatibility registry advertised by mobile bootstrap.
 *
 * Accepted request versions are enumerated rather than expressed as an open
 * range: a newly deployed server schema must never silently opt an old client
 * into semantics it does not understand. Response and evidence versions are
 * independently pinned so either side can add a new version without coupling
 * it to the transport protocol or Android release policy.
 */
export const WORKFORCE_MOBILE_SCHEMA_SUPPORT = Object.freeze({
  bootstrapResponse: Object.freeze({
    current: WORKFORCE_MOBILE_BOOTSTRAP_SCHEMA_VERSION,
    supported: Object.freeze([WORKFORCE_MOBILE_BOOTSTRAP_SCHEMA_VERSION]),
  }),
  workdayRequest: Object.freeze({
    preferred: WORKFORCE_WORKDAY_CURRENT_SCHEMA_VERSION,
    supported: Object.freeze([
      WORKFORCE_WORKDAY_LEGACY_SCHEMA_VERSION,
      2,
      3,
      4,
      WORKFORCE_WORKDAY_CURRENT_SCHEMA_VERSION,
    ]),
  }),
  workdayResponse: Object.freeze({
    current: WORKFORCE_WORKDAY_RESPONSE_SCHEMA_VERSION,
    supported: Object.freeze([WORKFORCE_WORKDAY_RESPONSE_SCHEMA_VERSION]),
  }),
  evidenceEnvelope: Object.freeze({
    preferred: WORKFORCE_EVIDENCE_ENVELOPE_VERSION,
    supported: Object.freeze([WORKFORCE_EVIDENCE_ENVELOPE_VERSION]),
  }),
  siteTransitionRequest: Object.freeze({
    preferred: WORKFORCE_SITE_TRANSITION_CLAIM_SCHEMA_VERSION,
    supported: Object.freeze([WORKFORCE_SITE_TRANSITION_CLAIM_SCHEMA_VERSION]),
  }),
})
