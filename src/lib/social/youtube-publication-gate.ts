import { normalizeSubjectTerm } from "@/lib/social/monitoring-subjects"

export const YOUTUBE_PUBLICATION_GATE_VERSION = "youtube-publication-gate-v3"

export type YouTubePublicationDecisionStatus = "MATCHED" | "REVIEW" | "REJECTED"
export type YouTubePublicationReasonCode =
  | "DETERMINISTIC_TERM_MATCH"
  | "NEGATIVE_TERM"
  | "MISSING_PUBLISHED_AT"
  | "STALE_PUBLICATION"
  | "SEARCH_PROVENANCE_ONLY"

export interface YouTubePublicationDecision {
  status: YouTubePublicationDecisionStatus
  reasonCode: YouTubePublicationReasonCode
  matchedTerms: string[]
  observedAt: string
  policySnapshot: {
    version: typeof YOUTUBE_PUBLICATION_GATE_VERSION
    candidateOnly: true
    commentsRequireMatched: true
    liveReplies: false
  }
}

function corpus(values: Array<string | null | undefined>): string {
  return normalizeSubjectTerm(values.filter((value): value is string => Boolean(value)).join(" \n "))
}

function matchingTerms(text: string, terms: string[]): string[] {
  return Array.from(new Set(terms
    .map(normalizeSubjectTerm)
    .filter(term => term.length > 0 && text.includes(term))))
    .sort()
}

export function decideYouTubePublication(input: {
  observedAt: Date
  publishedAt: Date | null
  freshnessSince: Date
  title?: string | null
  description?: string | null
  channelTitle?: string | null
  positiveTerms: string[]
  negativeTerms?: string[]
}): YouTubePublicationDecision {
  const text = corpus([input.title, input.description, input.channelTitle])
  const matchedTerms = matchingTerms(text, input.positiveTerms)
  const negativeMatch = matchingTerms(text, input.negativeTerms ?? [])[0]

  let status: YouTubePublicationDecisionStatus
  let reasonCode: YouTubePublicationReasonCode
  if (negativeMatch) {
    status = "REJECTED"
    reasonCode = "NEGATIVE_TERM"
  } else if (!input.publishedAt) {
    status = "REVIEW"
    reasonCode = "MISSING_PUBLISHED_AT"
  } else if (
    input.publishedAt.getTime() < input.freshnessSince.getTime()
    || input.publishedAt.getTime() > input.observedAt.getTime() + 5 * 60_000
  ) {
    status = "REJECTED"
    reasonCode = "STALE_PUBLICATION"
  } else if (matchedTerms.length > 0) {
    status = "MATCHED"
    reasonCode = "DETERMINISTIC_TERM_MATCH"
  } else {
    // Every caller reaches this gate with the subject's own provenance already
    // established: the video came back from YouTube's search.list for the
    // brand query, or an operator targeted that exact video. YouTube ranks on
    // tags, captions and semantics, so demanding the brand string inside
    // title/description/channelTitle discarded almost everything the platform
    // had just matched (prod, 2026-08-01: 25 found / 2 accepted). Platform
    // provenance is evidence, so the shortfall is missing *local* evidence —
    // operator review work, not a rejection. Comment collection still requires
    // MATCHED, so an unconfirmed video never triggers a paid comment run.
    status = "REVIEW"
    reasonCode = "SEARCH_PROVENANCE_ONLY"
  }

  return {
    status,
    reasonCode,
    matchedTerms,
    observedAt: input.observedAt.toISOString(),
    policySnapshot: {
      version: YOUTUBE_PUBLICATION_GATE_VERSION,
      candidateOnly: true,
      commentsRequireMatched: true,
      liveReplies: false,
    },
  }
}

export function isYouTubePublicationEligibleForComments(decision: YouTubePublicationDecision): boolean {
  return decision.status === "MATCHED"
}
