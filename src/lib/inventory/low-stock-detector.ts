/**
 * Low-stock detector — D7 Phase 6 Block A slice 1.
 *
 * Given an inventory item's current quantities, the effective threshold
 * (per-item override, falling back to tenant default), and whether an
 * unresolved alert already exists, decide one of three outcomes:
 *
 *   "none"          — available > threshold, no alert needed (or
 *                     available ≤ threshold but an open alert
 *                     already exists — no re-fire spam)
 *   "shouldEmit"    — available ≤ threshold AND no open alert → cron
 *                     INSERTs a LowStockAlert row
 *   "shouldResolve" — available > threshold AND an open alert exists →
 *                     cron sets resolvedAt on the open alert (stock
 *                     recovered)
 *
 * The cron polls inventory_items + joins lowStockAlerts (where
 * resolvedAt IS NULL) and consumes this helper's return to know
 * which mutation (if any) to perform.
 */
import { calculateAvailable } from "./available-quantity"
import type { DetectLowStockInput, DetectLowStockResult } from "./types"

/**
 * Centralized reason strings for the integrity-issue branches so the
 * cron + test regex don't drift if the wording is later tweaked.
 */
export const CORRUPTION_REASON =
  "InventoryItem row is corrupted (reserved > onHand or non-integer quantities); requires corruption-monitor escalation, NOT a low-stock alert"

export const MISCONFIGURED_THRESHOLD_REASON_PREFIX =
  "Invalid lowStockThreshold (must be non-negative integer); requires admin-config-monitor escalation, NOT a low-stock alert."

export function detectLowStock(
  input: DetectLowStockInput
): DetectLowStockResult {
  const { current, itemThreshold, tenantDefaultThreshold, hasOpenAlert } = input

  // Effective threshold: per-item override wins; fall back to tenant default.
  const effectiveThreshold =
    itemThreshold != null ? itemThreshold : tenantDefaultThreshold

  if (!Number.isInteger(effectiveThreshold) || effectiveThreshold < 0) {
    // Distinct from "none" — same silent-hide concern as the
    // corruption branch below. Slice-2 cron escalates to the admin-
    // config monitor (NOT a low-stock alert).
    return {
      kind: "misconfigured",
      reason: `${MISCONFIGURED_THRESHOLD_REASON_PREFIX} Got threshold=${effectiveThreshold}`,
    }
  }

  const avail = calculateAvailable(current)
  if (avail.isCorrupted) {
    // Distinct discriminant — slice-2 cron MUST handle this branch
    // (corruption alert via Slack admin / on-call, NOT a regular
    // low-stock LowStockAlert row). Returning the generic "none"
    // would silently hide BOTH the corruption AND any concurrent
    // low-stock signal. Architect P2 closure.
    return { kind: "corrupted", reason: CORRUPTION_REASON }
  }

  if (avail.available <= effectiveThreshold) {
    // Stock is below threshold.
    if (hasOpenAlert) {
      // Already alerted; no re-fire (cron-spam guard). The partial
      // UNIQUE on (inventoryItemId) WHERE resolvedAt IS NULL is the
      // DB-level backstop; this branch keeps the cron from even
      // attempting a duplicate INSERT.
      return { kind: "none", reason: "Already has an open alert; no re-fire" }
    }
    return {
      kind: "shouldEmit",
      effectiveThreshold,
      available: avail.available,
    }
  }

  // Stock is above threshold.
  if (hasOpenAlert) {
    // Stock recovered — resolve the open alert.
    return { kind: "shouldResolve", reason: "Available > threshold; resolve open alert" }
  }
  return { kind: "none", reason: "Available > threshold; no alert needed" }
}
