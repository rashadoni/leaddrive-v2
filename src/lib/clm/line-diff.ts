/**
 * CLM Slice 1d — pure line-level diff helper.
 *
 * Uses a Myers-style LCS (longest common subsequence) to produce a
 * line-by-line changeset between two text bodies. No external deps.
 *
 * Output type:
 *   LineDiffChunk[]
 *   where each chunk has type "unchanged" | "added" | "removed"
 *   and a `text` string (the raw line content, no newline character).
 *
 * Usage:
 *   import { computeLineDiff } from "@/lib/clm/line-diff"
 *   const chunks = computeLineDiff(oldBody, newBody)
 */

export type LineDiffType = "unchanged" | "added" | "removed"

export interface LineDiffChunk {
  type: LineDiffType
  text: string
}

/**
 * Compute a line-level LCS-based diff between `aText` and `bText`.
 * Returns an ordered array of LineDiffChunk covering every line in both inputs.
 *
 * Complexity: O(m * n) time and space (classic DP). Callers MUST enforce a
 * size cap before invoking this function — the compare dialog in
 * `src/app/(dashboard)/contracts/[id]/page.tsx` guards against inputs
 * exceeding ~4 000 lines / 200 000 chars and shows a "too large" message
 * instead of running the diff. Do NOT call this on unbounded user content.
 */
export function computeLineDiff(aText: string, bText: string): LineDiffChunk[] {
  const aLines = splitLines(aText)
  const bLines = splitLines(bText)

  const lcs = computeLCS(aLines, bLines)
  return buildChunks(aLines, bLines, lcs)
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Split a text block into lines. Preserves empty trailing lines only when the
 * original text ends with a newline (so round-trip length is predictable).
 */
function splitLines(text: string): string[] {
  if (text === "") return []
  return text.split("\n")
}

/**
 * Classic O(m*n) LCS via dynamic programming.
 * Returns the LCS length table (used to reconstruct the diff path).
 */
function computeLCS(a: string[], b: string[]): number[][] {
  const m = a.length
  const n = b.length
  // Allocate (m+1) × (n+1) table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }
  return dp
}

/**
 * Backtrack through the LCS table to produce LineDiffChunks.
 */
function buildChunks(a: string[], b: string[], dp: number[][]): LineDiffChunk[] {
  const chunks: LineDiffChunk[] = []
  let i = a.length
  let j = b.length

  // Backtrack stack (reversed — we reverse at end)
  const reversed: LineDiffChunk[] = []

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      reversed.push({ type: "unchanged", text: a[i - 1] })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      reversed.push({ type: "added", text: b[j - 1] })
      j--
    } else {
      reversed.push({ type: "removed", text: a[i - 1] })
      i--
    }
  }

  // Reverse so output is top-to-bottom
  for (let k = reversed.length - 1; k >= 0; k--) {
    chunks.push(reversed[k])
  }

  return chunks
}
