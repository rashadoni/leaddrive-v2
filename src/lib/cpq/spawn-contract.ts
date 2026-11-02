/**
 * S6 CPQ slice-3 piece-4.5 — pure helper that builds the Contract
 * `data` payload spawned from an accepted Quote.
 *
 * Extracted from `src/app/api/v1/quotes/[id]/route.ts` so the data
 * construction is unit-testable in isolation (without mocking
 * `prisma.$transaction`). The route layer remains the orchestrator
 * (org-scoped deal lookup, transaction wrapping, response shaping);
 * this file owns the field-by-field mapping rules.
 *
 * Invariants enforced here:
 *   - contractNumber: `${quoteNumber}-CTR-${quoteIdSuffix}` — sales-rep
 *     friendly + collision-resistant. Last 6 chars of the quote's cuid
 *     give ~10⁹ namespace per quoteNumber prefix; Contract has no
 *     `@@unique([orgId, contractNumber])` per schema:1108-1188 so this
 *     suffix is the only collision guard at this layer.
 *   - title: human-grade — "Quote {number} acceptance" — appears in
 *     contract list views as a clear provenance trail. Written in the
 *     organization's language (it was English for everybody, so an
 *     Azerbaijani list read «Quote Q-12 acceptance»).
 *   - type: "service_agreement" — sensible default for CPQ-driven
 *     contracts; user can edit on the detail page.
 *   - status: "draft" — never auto-finalises; user explicitly transitions
 *     via approval / e-sign flow.
 *   - companyId / dealId / valueAmount / currency: copied from the
 *     accepted Quote + linked Deal. Money values come from the rolled
 *     totals the route just persisted on the quote (single source of
 *     truth — no second computation that could drift).
 *   - startDate: now (transition timestamp).
 *   - notes: auto-explain provenance so the contract row is
 *     self-documenting in the contracts list.
 *   - spawnedFromQuoteId: the @unique field that physically guarantees
 *     one-to-one Quote ↔ Contract (slice-3 piece-4 migration).
 */
import type { Prisma } from "@prisma/client"
import type { Locale } from "@/i18n/routing"

/** The draft's own words, in the organization's language. */
export const SPAWNED_CONTRACT_TEXT: Record<Locale, { title: (quote: string) => string; notes: (quote: string) => string }> = {
  az: {
    title: (quote) => `${quote} təklifinin qəbulu`,
    notes: (quote) => `Qəbul edilmiş ${quote} təklifindən avtomatik yaradılıb.`,
  },
  ru: {
    title: (quote) => `Принятие КП ${quote}`,
    notes: (quote) => `Создан автоматически из принятого КП ${quote}.`,
  },
  en: {
    title: (quote) => `Quote ${quote} acceptance`,
    notes: (quote) => `Auto-spawned from accepted quote ${quote}.`,
  },
}

export interface SpawnContractInput {
  organizationId: string
  quote: {
    id: string
    quoteNumber: string
    currency: string
    dealId: string | null
  }
  /** From the route layer's just-persisted rollUpQuote totals. */
  rolledTotalAmount: Prisma.Decimal | string
  /** Pre-resolved via org-scoped findFirst on the route layer. */
  dealCompanyId: string | null
  /** Session user id; null when no session (rare — system-initiated). */
  createdByUserId: string | null
  /** Override for test determinism. Default new Date(). */
  now?: Date
  /** The organization's language for the title and notes. Default English. */
  locale?: Locale
}

export function buildSpawnedContractData(input: SpawnContractInput): Prisma.ContractUncheckedCreateInput {
  const { organizationId, quote, rolledTotalAmount, dealCompanyId, createdByUserId } = input
  const now = input.now ?? new Date()
  const text = SPAWNED_CONTRACT_TEXT[input.locale ?? "en"]

  // Suffix is the last 6 chars of the quote's cuid — gives ~32^6
  // (~10^9) namespace per quoteNumber prefix. Sufficient to avoid
  // collisions with both (a) manually-created contracts that happen
  // to use the same `{number}-CTR` convention, and (b) residue from
  // a delete-then-respawn cycle.
  const contractNumber = `${quote.quoteNumber}-CTR-${quote.id.slice(-6)}`

  return {
    organizationId,
    contractNumber,
    title: text.title(quote.quoteNumber),
    type: "service_agreement",
    status: "draft",
    companyId: dealCompanyId,
    dealId: quote.dealId,
    currency: quote.currency,
    valueAmount: typeof rolledTotalAmount === "string" ? rolledTotalAmount : rolledTotalAmount.toString(),
    startDate: now,
    notes: text.notes(quote.quoteNumber),
    createdBy: createdByUserId,
    spawnedFromQuoteId: quote.id,
  }
}
