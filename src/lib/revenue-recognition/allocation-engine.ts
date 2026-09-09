/**
 * ASC 606 step-4 allocation engine — M4 Phase 6 Block C slice 1.
 *
 * Given a contract total and N performance obligations with their
 * standalone selling prices (SSPs), allocate the transaction price
 * proportionally to each PO.
 *
 *   allocated[i] = contractTotal * (ssp[i] / sum(ssp))
 *
 * All math is in **integer minor units** (e.g. cents) — no Float
 * arithmetic anywhere in the helper, no precision drift.
 *
 * Edge cases handled:
 *   • Single PO without SSP    — full contract total allocated.
 *   • All POs without SSP      — equal-split fallback (count-based).
 *   • Mixed null + non-null SSP → REJECTED (ambiguous semantics).
 *   • Sum(SSP) == 0            — REJECTED (would divide by zero).
 *   • Rounding remainder       — distributed to earliest POs by 1
 *     minor unit each, preserving sum-invariant (sum(allocated) ==
 *     contractTotal exactly).
 *
 * Pure synchronous.
 */
import type {
  AllocateInput,
  AllocateResult,
  PoAllocationOutput,
} from "./types"

function isNonNegInteger(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0
}

export function allocateTransactionPrice(input: AllocateInput): AllocateResult {
  // 1. Input validation.
  if (!isNonNegInteger(input.contractTotalMinor)) {
    return {
      ok: false,
      error: "contractTotalMinor must be a non-negative integer (minor units)",
    }
  }
  if (typeof input.currency !== "string" || !/^[A-Z]{3}$/.test(input.currency)) {
    return { ok: false, error: "currency must be a 3-letter ISO-4217 code" }
  }
  if (!Array.isArray(input.obligations) || input.obligations.length === 0) {
    return { ok: false, error: "obligations must be a non-empty array" }
  }
  for (let i = 0; i < input.obligations.length; i++) {
    const o = input.obligations[i]
    if (typeof o.id !== "string" || o.id.length === 0) {
      return { ok: false, error: `obligations[${i}].id must be a non-empty string` }
    }
    if (o.ssp !== null && !isNonNegInteger(o.ssp)) {
      return {
        ok: false,
        error: `obligations[${i}].ssp must be null or a non-negative integer (minor units)`,
      }
    }
  }

  // 2. Ambiguity guard: all-null OR all-non-null. Mixed is rejected.
  const nullCount = input.obligations.filter((o) => o.ssp === null).length
  if (nullCount > 0 && nullCount < input.obligations.length) {
    return {
      ok: false,
      error:
        "obligations must be either ALL with SSP or ALL without — mixed null + non-null is ambiguous",
    }
  }

  // 3. Single-PO shortcut: full contract total to that PO.
  if (input.obligations.length === 1) {
    return {
      ok: true,
      allocations: [
        { id: input.obligations[0].id, allocatedMinor: input.contractTotalMinor },
      ],
    }
  }

  // 4. Multi-PO branch.
  const allocations: PoAllocationOutput[] = []

  if (nullCount === input.obligations.length) {
    // No-SSP fallback: equal split. Distribute remainder to earliest POs.
    const n = input.obligations.length
    const base = Math.floor(input.contractTotalMinor / n)
    let remainder = input.contractTotalMinor - base * n
    for (let i = 0; i < input.obligations.length; i++) {
      const extra = remainder > 0 ? 1 : 0
      remainder -= extra
      allocations.push({
        id: input.obligations[i].id,
        allocatedMinor: base + extra,
      })
    }
    return { ok: true, allocations }
  }

  // SSP-weighted allocation.
  const sspSum = input.obligations.reduce((acc, o) => acc + (o.ssp ?? 0), 0)
  if (sspSum === 0) {
    return {
      ok: false,
      error: "sum of SSPs is 0 — cannot allocate by weight; either use SSP=null on all or set non-zero SSPs",
    }
  }

  // Pass 1: BigInt-safe proportional share (contractTotal × ssp may
  // exceed 2^53 for large enterprise contracts — e.g. $1B contractTotal
  // × $1B SSP = 1e22, well above Number.MAX_SAFE_INTEGER 9e15).
  // architect-pass-1 closed this. Remainder is distributed earliest-
  // first in pass 2 — tie-break is deterministic by `obligations`
  // order, which the caller passes as displayOrder-ascending.
  let allocatedSum = 0
  const contractBig = BigInt(input.contractTotalMinor)
  const sspSumBig = BigInt(sspSum)
  for (let i = 0; i < input.obligations.length; i++) {
    const ssp = input.obligations[i].ssp ?? 0
    const exactBig = (contractBig * BigInt(ssp)) / sspSumBig // BigInt floor div
    const floored = Number(exactBig)
    allocations.push({ id: input.obligations[i].id, allocatedMinor: floored })
    allocatedSum += floored
  }

  // Pass 2: distribute rounding remainder to earliest POs (sum-invariant).
  let remainder = input.contractTotalMinor - allocatedSum
  for (let i = 0; i < allocations.length && remainder > 0; i++) {
    allocations[i].allocatedMinor += 1
    remainder -= 1
  }

  // Sanity: sum invariant holds. Defensive — should never fire.
  const finalSum = allocations.reduce((acc, a) => acc + a.allocatedMinor, 0)
  if (finalSum !== input.contractTotalMinor) {
    return {
      ok: false,
      error: `internal: allocation sum ${finalSum} != contractTotalMinor ${input.contractTotalMinor}`,
    }
  }

  return { ok: true, allocations }
}
