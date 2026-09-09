/**
 * Intent signal classifier — C5 slice 1.
 *
 * Maps a raw SignalKind to:
 *   • category — passive / engaged / high_intent / third_party
 *   • defaultWeight — slice-1 baseline weight (slice-2 reads per-tenant config)
 *   • mqlQualifying — whether a single such signal can promote to MQL
 *
 * Classification table:
 *   page_view_research      → passive,      weight 1,  not-MQL
 *   social_engagement       → passive,      weight 2,  not-MQL
 *   email_engagement        → engaged,      weight 3,  not-MQL
 *   content_download        → engaged,      weight 5,  not-MQL
 *   event_attendance        → engaged,      weight 8,  not-MQL
 *   page_view_high_intent   → high_intent,  weight 10, not-MQL  (need multiple)
 *   competitor_research     → high_intent,  weight 15, not-MQL
 *   chat_high_intent        → high_intent,  weight 20, MQL
 *   form_submission         → high_intent,  weight 25, MQL
 *   third_party_intent      → third_party,  weight 5,  not-MQL
 *
 * Pure synchronous.
 */
import {
  SIGNAL_KINDS,
  type ClassifySignalInput,
  type ClassifySignalResult,
  type SignalCategory,
  type SignalClassification,
  type SignalKind,
} from "./types"

const CLASSIFICATION_TABLE: Readonly<
  Record<
    SignalKind,
    {
      category: SignalCategory
      defaultWeight: number
      mqlQualifying: boolean
    }
  >
> = {
  page_view_research: {
    category: "passive",
    defaultWeight: 1,
    mqlQualifying: false,
  },
  social_engagement: {
    category: "passive",
    defaultWeight: 2,
    mqlQualifying: false,
  },
  email_engagement: {
    category: "engaged",
    defaultWeight: 3,
    mqlQualifying: false,
  },
  content_download: {
    category: "engaged",
    defaultWeight: 5,
    mqlQualifying: false,
  },
  event_attendance: {
    category: "engaged",
    defaultWeight: 8,
    mqlQualifying: false,
  },
  page_view_high_intent: {
    category: "high_intent",
    defaultWeight: 10,
    mqlQualifying: false,
  },
  competitor_research: {
    category: "high_intent",
    defaultWeight: 15,
    mqlQualifying: false,
  },
  chat_high_intent: {
    category: "high_intent",
    defaultWeight: 20,
    mqlQualifying: true,
  },
  form_submission: {
    category: "high_intent",
    defaultWeight: 25,
    mqlQualifying: true,
  },
  third_party_intent: {
    category: "third_party",
    defaultWeight: 5,
    mqlQualifying: false,
  },
}

function isSignalKind(v: unknown): v is SignalKind {
  return typeof v === "string" && (SIGNAL_KINDS as readonly string[]).includes(v)
}

export function classifySignal(input: ClassifySignalInput): ClassifySignalResult {
  if (!isSignalKind(input.signalKind)) {
    return {
      ok: false,
      error: `unknown signalKind "${String(input.signalKind)}"`,
    }
  }
  if (
    input.resourceRef !== null &&
    input.resourceRef !== undefined &&
    typeof input.resourceRef !== "string"
  ) {
    return { ok: false, error: "resourceRef must be a string if supplied" }
  }

  const entry = CLASSIFICATION_TABLE[input.signalKind]
  const classification: SignalClassification = {
    category: entry.category,
    defaultWeight: entry.defaultWeight,
    mqlQualifying: entry.mqlQualifying,
  }
  return { ok: true, classification }
}

/** Test-only — surfaces table for drift guards. */
export const __CLASSIFIER_INTERNALS = { CLASSIFICATION_TABLE }
