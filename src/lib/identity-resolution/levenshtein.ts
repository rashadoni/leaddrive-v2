/**
 * Levenshtein edit distance + similarity — G2 Phase 6 Block B slice 1.
 *
 * Classic DP implementation. Computes the minimum number of single-
 * character edits (insertions, deletions, substitutions) to transform
 * string A into string B.
 *
 * Used by the fuzzy-matcher for:
 *   • email local-part comparison ("jon" vs "john" → distance 1)
 *   • phone digit-string comparison (after E.164 normalization)
 *   • name comparison (after lowercase + whitespace-collapse)
 *
 * Space: O(min(|a|, |b|)) via the rolling-row trick — only one row
 * of the DP table is kept in memory. Time: O(|a| × |b|).
 *
 * Pure synchronous. No early-termination for distance bounds yet —
 * slice-3 can add a bounded variant if perf becomes a concern.
 */

/**
 * Compute the Levenshtein distance between two strings.
 *
 * Edge cases:
 *   - Either string empty → distance = other.length
 *   - Identical strings → 0
 *   - Inputs are compared CASE-SENSITIVELY — caller normalizes (the
 *     fuzzy-matcher passes already-lowercased input from G1 identity
 *     normalization).
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  // Pick the shorter string as the "columns" dimension to minimize
  // memory. The DP table grows as O(min(|a|, |b|)).
  const [short, long] =
    a.length <= b.length ? [a, b] : [b, a]

  const m = short.length
  let prevRow = new Array<number>(m + 1)
  let currRow = new Array<number>(m + 1)
  for (let j = 0; j <= m; j++) prevRow[j] = j

  for (let i = 1; i <= long.length; i++) {
    currRow[0] = i
    const longChar = long[i - 1]
    for (let j = 1; j <= m; j++) {
      const shortChar = short[j - 1]
      const cost = longChar === shortChar ? 0 : 1
      currRow[j] = Math.min(
        currRow[j - 1] + 1, // insertion
        prevRow[j] + 1, // deletion
        prevRow[j - 1] + cost // substitution
      )
    }
    // Swap rows for the next iteration.
    const tmp = prevRow
    prevRow = currRow
    currRow = tmp
  }

  return prevRow[m]
}

/**
 * Compute a 0..1 similarity score from Levenshtein distance:
 *   similarity = 1 - (distance / maxLength)
 *
 * Edge cases:
 *   - Both empty → 1 (perfect match — nothing to mismatch on)
 *   - One empty → 0 (max possible mismatch)
 *   - Otherwise → between 0 (every char different) and 1 (identical)
 *
 * Symmetric: levenshteinSimilarity(a, b) === levenshteinSimilarity(b, a).
 */
export function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1 // both empty
  const distance = levenshteinDistance(a, b)
  return 1 - distance / maxLen
}
