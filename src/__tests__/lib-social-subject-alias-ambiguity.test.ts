import { describe, expect, it } from "vitest"
import {
  AMBIGUOUS_SINGLE_TOKEN_MAX_LENGTH,
  defaultAliasAmbiguity,
} from "@/lib/social/monitoring-subjects"

// #636: the old rule (NAME && length <= 4) let any 5+ character word — or any
// hashtag — auto-accept at confidence 1 from anywhere on a global platform.
describe("default alias ambiguity", () => {
  it.each([
    // Bare single words are weak evidence regardless of the old 4-char floor.
    ["NAME", "oba", true],
    ["NAME", "araz", true],
    ["NAME", "bravo", true],
    ["NAME", "proqnoz", true],
    // Boundary: the threshold itself is ambiguous, one past it is not.
    ["NAME", "a".repeat(AMBIGUOUS_SINGLE_TOKEN_MAX_LENGTH), true],
    ["NAME", "a".repeat(AMBIGUOUS_SINGLE_TOKEN_MAX_LENGTH + 1), false],
    // Brand compounds are distinctive single tokens.
    ["NAME", "arazsupermarket", false],
    ["NAME", "bakuelectronics", false],
    // Multi-word phrases stay non-ambiguous by default; the operator can
    // still mark one ambiguous explicitly (e.g. "bravo supermarket").
    ["NAME", "bravo supermarket", false],
    ["NAME", "hava proqnozu", false],
    // The matcher's optional "#?"/"@?" prefix means a short hashtag or handle
    // alias also matches the bare word in plain text — same rule as NAME,
    // otherwise one mirrored brand hashtag defeats the whole gate.
    ["HASHTAG", "oba", true],
    ["HANDLE", "oba", true],
    ["HASHTAG", "arazsupermarket", false],
    // Veto and context kinds are outside the heuristic entirely.
    ["NEGATIVE", "oba", false],
    ["CONTEXT", "oba", false],
  ] as const)("classifies %s %j as ambiguous=%s", (kind, normalizedValue, expected) => {
    expect(defaultAliasAmbiguity(kind, normalizedValue)).toBe(expected)
  })
})
