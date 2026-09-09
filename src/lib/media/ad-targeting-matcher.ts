/**
 * Ad targeting matcher — R11 slice 1.
 *
 * Given a campaign's targeting criteria + a candidate subscriber +
 * content context, decide if the ad should serve and emit a score
 * (caller may rank multiple matching campaigns by score).
 *
 * Matching rules:
 *   • Every facet supplied in criteria is an AND constraint.
 *     If criteria.tiers is supplied, subscriber.tierSlug must be IN.
 *   • Empty / undefined facet = any (no constraint).
 *   • Content licensedRegions: if non-empty, subscriber.billingRegion
 *     must be IN (licensing geo-restriction). Empty = global.
 *   • Score = (matched facets) / (active facets). Range 0..1.
 *   • Result.matched = true iff all active facets matched.
 *
 * Pure synchronous.
 */
import {
  CONTENT_KINDS,
  type MatchAdTargetingInput,
  type MatchAdTargetingResult,
  type TargetingMatchResult,
} from "./types"

export function matchAdTargeting(
  input: MatchAdTargetingInput
): MatchAdTargetingResult {
  if (input.criteria === null || typeof input.criteria !== "object") {
    return { ok: false, error: "criteria must be an object" }
  }
  if (input.subscriber === null || typeof input.subscriber !== "object") {
    return { ok: false, error: "subscriber must be an object" }
  }
  if (input.content === null || typeof input.content !== "object") {
    return { ok: false, error: "content must be an object" }
  }
  if (typeof input.subscriber.tierSlug !== "string") {
    return { ok: false, error: "subscriber.tierSlug must be a string" }
  }
  if (
    !(CONTENT_KINDS as readonly string[]).includes(input.content.contentKind)
  ) {
    return {
      ok: false,
      error: `content.contentKind "${String(input.content.contentKind)}" not in allow-list`,
    }
  }
  if (!Array.isArray(input.content.licensedRegions)) {
    return { ok: false, error: "content.licensedRegions must be an array" }
  }

  const matchedFacets: string[] = []
  const unmatchedFacets: string[] = []
  let activeFacets = 0

  // Tier match
  if (input.criteria.tiers && input.criteria.tiers.length > 0) {
    activeFacets++
    if (input.criteria.tiers.includes(input.subscriber.tierSlug)) {
      matchedFacets.push("tier")
    } else {
      unmatchedFacets.push("tier")
    }
  }

  // Region match
  if (input.criteria.regions && input.criteria.regions.length > 0) {
    activeFacets++
    if (
      input.subscriber.billingRegion !== null &&
      input.criteria.regions.includes(input.subscriber.billingRegion)
    ) {
      matchedFacets.push("region")
    } else {
      unmatchedFacets.push("region")
    }
  }

  // Genre match (against content)
  if (input.criteria.genres && input.criteria.genres.length > 0) {
    activeFacets++
    if (
      input.content.genreSlug !== null &&
      input.criteria.genres.includes(input.content.genreSlug)
    ) {
      matchedFacets.push("genre")
    } else {
      unmatchedFacets.push("genre")
    }
  }

  // Content-kind match
  if (input.criteria.contentKinds && input.criteria.contentKinds.length > 0) {
    activeFacets++
    if (input.criteria.contentKinds.includes(input.content.contentKind)) {
      matchedFacets.push("contentKind")
    } else {
      unmatchedFacets.push("contentKind")
    }
  }

  // Language match (against content)
  if (input.criteria.languages && input.criteria.languages.length > 0) {
    activeFacets++
    if (
      input.content.languageCode !== null &&
      input.criteria.languages.includes(input.content.languageCode)
    ) {
      matchedFacets.push("language")
    } else {
      unmatchedFacets.push("language")
    }
  }

  // Licensing geo-restriction (content-side, always checked).
  // licensedRegions = [] means global; otherwise subscriber must be in.
  let licensingOK = true
  if (input.content.licensedRegions.length > 0) {
    licensingOK =
      input.subscriber.billingRegion !== null &&
      input.content.licensedRegions.includes(input.subscriber.billingRegion)
    if (!licensingOK) {
      unmatchedFacets.push("licensing")
    }
  }

  // If no targeting facets are active AND licensing OK, default to
  // matched with score 1.0 (run-of-site).
  const matched =
    licensingOK &&
    matchedFacets.length === activeFacets &&
    unmatchedFacets.length === 0
  let score: number
  if (!licensingOK) {
    // Licensing is a hard gate: failing it means the ad CANNOT serve
    // regardless of how well the other facets match. Force score = 0
    // so downstream rankers don't pick this campaign over a lower-
    // scoring but licensing-OK alternative.
    score = 0
  } else if (activeFacets === 0) {
    score = 1
  } else {
    score = matchedFacets.length / activeFacets
  }

  const result: TargetingMatchResult = {
    matched,
    score,
    matchedFacets,
    unmatchedFacets,
  }
  return { ok: true, match: result }
}
