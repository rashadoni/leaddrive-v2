/**
 * The contract wizard (owner 2026-11-25, mock «Мастер договора по ВÖEN»):
 * template → parties → terms → check. Our side comes from «Settings →
 * Invoices», the other side from the tax registry by VÖEN plus its company
 * card's bank, the money from the deal. The text is the template with its
 * standard fields filled (src/lib/clm/standard-fields.ts) and the parties'
 * requisites as the closing section.
 *
 * Pure: the route loads the rows and writes; this decides the text and what a
 * company card gains.
 */
import { substituteClauses } from "@/lib/contract-lifecycle/clause-substituter"
import type { TemplateClause, TemplateVariable } from "@/lib/contract-lifecycle/types"
import { BANK_FIELDS, emptyBank, hasBank, readBank, type BankField, type BankRequisites } from "@/lib/companies/bank-requisites"
import {
  fillTemplate,
  requisitesBlock,
  standardValues,
  templateNamesCounterparty,
  type ContractParty,
  type FieldLang,
} from "@/lib/clm/standard-fields"

export const OUR_BANK_FROM_SETTINGS = "settings"

export interface OurBankChoice {
  /** `settings` for the bank in «Settings → Invoices», else a BankAccount id. */
  id: string
  label: string
  bank: BankRequisites
}

/** Our side as «Settings → Invoices» describes it, and the banks it may name. */
export function ourSide(
  invoiceSettings: Record<string, unknown> | null | undefined,
  organizationName: string,
  bankAccounts: Array<{ id: string; accountName: string; accountNumber: string | null; bankName: string; bankCode: string | null; swiftCode: string | null; currency: string }>,
): { party: Omit<ContractParty, "bank">; banks: OurBankChoice[] } {
  const s = invoiceSettings ?? {}
  const text = (key: string) => (typeof s[key] === "string" && (s[key] as string).trim() ? (s[key] as string).trim() : null)
  const banks: OurBankChoice[] = []
  const settingsBank = readBank(s as Partial<Record<BankField, unknown>>)
  if (hasBank(settingsBank)) {
    banks.push({ id: OUR_BANK_FROM_SETTINGS, label: [settingsBank.bankName, settingsBank.bankAccount].filter(Boolean).join(" · "), bank: settingsBank })
  }
  for (const account of bankAccounts) {
    if (!account.accountNumber) continue
    // The same account as in the settings is not offered twice.
    if (account.accountNumber.replace(/\s/g, "") === settingsBank.bankAccount?.replace(/\s/g, "")) continue
    banks.push({
      id: account.id,
      label: `${account.bankName} · ${account.accountNumber} · ${account.currency}`,
      bank: { ...emptyBank(), bankName: account.bankName, bankCode: account.bankCode, bankSwift: account.swiftCode, bankAccount: account.accountNumber },
    })
  }
  return {
    party: {
      name: text("companyName") ?? organizationName,
      voen: text("companyVoen"),
      address: text("companyAddress"),
      director: text("directorName"),
    },
    banks,
  }
}

export interface WizardTemplate {
  id: string
  name: string
  version: number
  defaultContractType: string
  defaultDurationMonths: number | null
  clauses: TemplateClause[]
  variables: TemplateVariable[]
}

export interface WizardText {
  renderedBody: string
  /** Template variables still empty and required: creating refuses until they are filled. */
  missing: string[]
  /** The variables a person fills on step 3, with what the template says about each. */
  asked: TemplateVariable[]
  /** Standard fields filled by the wizard. */
  standard: string[]
}

/** Shown in the preview where a person still has to write something. */
export const BLANK = "________"

/**
 * The contract's text. With `preview`, a required field nobody filled reads
 * as a blank line instead of failing, so step 4 can show the whole document.
 */
export function wizardText(input: {
  template: WizardTemplate | null
  our: ContractParty
  counterparty: ContractParty
  date: Date
  amount: number | null
  currency: string | null
  typed: Record<string, string | number | boolean>
  lang: FieldLang
  preview: boolean
}): WizardText | { error: "substitution"; details: unknown } {
  const block = requisitesBlock(input.our, input.counterparty, input.lang)
  if (!input.template) return { renderedBody: block, missing: [], asked: [], standard: [] }

  const standard = standardValues({ our: input.our, counterparty: input.counterparty, date: input.date, amount: input.amount, currency: input.currency })
  const fill = fillTemplate(input.template.variables, standard, input.typed, { date: input.date, amount: input.amount })
  const standardNames = fill.filled.filter((f) => f.source === "standard").map((f) => f.name)
  // An empty required field is the person's to fill, not a broken template:
  // for the contract itself, say which before the substituter would refuse.
  if (!input.preview && fill.missing.length > 0) {
    return { renderedBody: "", missing: fill.missing, asked: fill.asked, standard: standardNames }
  }
  const values = { ...fill.values }
  let variables = input.template.variables
  if (input.preview && fill.missing.length > 0) {
    // A blank in the preview is text, whatever type the template declares.
    variables = variables.map((v) => (fill.missing.includes(v.name) ? { ...v, type: "string" as const, required: false } : v))
    for (const name of fill.missing) values[name] = BLANK
  }
  const result = substituteClauses({ clauses: input.template.clauses, variables, values })
  if (!result.ok) {
    return { error: "substitution", details: { missingVars: result.missingVars, unknownVars: result.unknownVars, typeMismatches: result.typeMismatches } }
  }
  const body = templateNamesCounterparty(input.template.clauses) ? result.renderedBody : `${result.renderedBody.trimEnd()}\n\n${block}`
  return {
    renderedBody: body,
    missing: fill.missing,
    asked: fill.asked,
    standard: standardNames,
  }
}

export interface CounterpartyInput {
  voen: string | null
  name: string
  address: string | null
  director: string | null
  bank: BankRequisites
  saveBank: boolean
}

export interface CompanyRow {
  id: string
  name: string
  voen: string | null
  address: string | null
  director: string | null
  externalSource: string | null
  bankName: string | null
  bankCode: string | null
  bankSwift: string | null
  bankAccount: string | null
  bankVoen: string | null
  bankCorrAccount: string | null
}

/**
 * What the wizard writes to an existing company card: only what the card has
 * empty — VÖEN, director, address (never a 1C pharmacy's address) — and the
 * bank when the person ticked «save on the card». The name is never changed:
 * a card's name is how people find it.
 */
export function companyChanges(company: CompanyRow, input: CounterpartyInput): Record<string, string | null> {
  const changes: Record<string, string | null> = {}
  if (!company.voen && input.voen) changes.voen = input.voen
  if (!company.director && input.director) changes.director = input.director
  if (!company.address && input.address && !company.externalSource) changes.address = input.address
  if (input.saveBank && hasBank(input.bank)) {
    for (const field of BANK_FIELDS) {
      if ((company[field] ?? null) !== (input.bank[field] ?? null)) changes[field] = input.bank[field]
    }
  }
  return changes
}

/** The party as the contract names it: what the person confirmed on step 2. */
export function counterpartyParty(input: CounterpartyInput): ContractParty {
  return { name: input.name, voen: input.voen, address: input.address, director: input.director, bank: input.bank }
}

/** End date from the template's default duration, counted from the start. */
export function defaultEndDate(start: Date, months: number | null): Date | undefined {
  if (!months || months <= 0) return undefined
  const end = new Date(start)
  end.setUTCMonth(end.getUTCMonth() + months)
  end.setUTCDate(end.getUTCDate() - 1)
  return end
}
