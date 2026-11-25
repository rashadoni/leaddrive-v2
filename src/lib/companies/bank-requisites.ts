/**
 * A company's bank requisites — the counterparty's half of a contract's
 * «Tərəflərin rekvizitləri». The names mirror the organisation's own in
 * `settings.invoice` (src/app/api/v1/settings/invoice/route.ts), so the two
 * sides of a contract read the same way.
 *
 * The tax registry gives no bank, so these are typed in once — on the company
 * form or in the contract wizard — and the next contract fills them by itself.
 */
import { z } from "zod"

export const BANK_FIELDS = ["bankName", "bankCode", "bankSwift", "bankAccount", "bankVoen", "bankCorrAccount"] as const
export type BankField = (typeof BANK_FIELDS)[number]
export type BankRequisites = Record<BankField, string | null>

/** Blank becomes null: an emptied field clears the card, it does not store "". */
const bankText = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => (value === undefined ? undefined : value?.trim() ? value.trim().replace(/\s+/g, " ") : null))

export const companyBankFields = {
  bankName: bankText(200),
  bankCode: bankText(50),
  bankSwift: bankText(20),
  bankAccount: bankText(50),
  bankVoen: bankText(50),
  bankCorrAccount: bankText(50),
}

export const bankRequisitesSchema = z.object(companyBankFields).strict()

export function emptyBank(): BankRequisites {
  return { bankName: null, bankCode: null, bankSwift: null, bankAccount: null, bankVoen: null, bankCorrAccount: null }
}

/** The bank part of any row that carries these columns (a company, the invoice settings). */
export function readBank(source: Partial<Record<BankField, unknown>> | null | undefined): BankRequisites {
  const bank = emptyBank()
  for (const field of BANK_FIELDS) {
    const value = source?.[field]
    bank[field] = typeof value === "string" && value.trim() ? value.trim() : null
  }
  return bank
}

/** A bank with an account number is one a contract can name. */
export function hasBank(bank: BankRequisites): boolean {
  return Boolean(bank.bankAccount)
}
