/**
 * Standard fields of a contract template — the variables the contract wizard
 * fills by itself (owner 2026-11-25, mock «Мастер договора по ВÖEN»):
 *
 *   our_*           — our side, from «Settings → Invoices» (settings.invoice);
 *   counterparty_*  — the other side, from the tax registry by VÖEN and the
 *                     company card's bank requisites;
 *   contract_*      — date, amount and currency (the deal, or today).
 *
 * A template uses them like any variable — `{{counterparty_voen}}` — and
 * declares them in its variables list. The wizard asks a person only for the
 * variables that are not standard and have no default.
 *
 * The names are ASCII because the substituter reads `{{[A-Za-z_][A-Za-z0-9_]*}}`
 * (src/lib/contract-lifecycle/clause-substituter.ts).
 */
import type { TemplateClause, TemplateVariable } from "@/lib/contract-lifecycle/types"
import type { BankRequisites } from "@/lib/companies/bank-requisites"

export type FieldLang = "az" | "ru" | "en"

export interface ContractParty {
  name: string
  voen: string | null
  address: string | null
  director: string | null
  bank: BankRequisites
}

const PARTY_FIELDS = [
  ["name", (p: ContractParty) => p.name],
  ["voen", (p: ContractParty) => p.voen],
  ["address", (p: ContractParty) => p.address],
  ["director", (p: ContractParty) => p.director],
  ["bank_name", (p: ContractParty) => p.bank.bankName],
  ["bank_code", (p: ContractParty) => p.bank.bankCode],
  ["bank_swift", (p: ContractParty) => p.bank.bankSwift],
  ["iban", (p: ContractParty) => p.bank.bankAccount],
  ["bank_voen", (p: ContractParty) => p.bank.bankVoen],
  ["corr_account", (p: ContractParty) => p.bank.bankCorrAccount],
] as const

export const STANDARD_FIELD_NAMES: readonly string[] = [
  ...PARTY_FIELDS.map(([key]) => `our_${key}`),
  ...PARTY_FIELDS.map(([key]) => `counterparty_${key}`),
  "contract_date",
  "contract_amount",
  "contract_currency",
]

export function isStandardField(name: string): boolean {
  return STANDARD_FIELD_NAMES.includes(name)
}

export interface StandardInput {
  our: ContractParty
  counterparty: ContractParty
  /** The contract's date — the day it is made. */
  date: Date
  amount: number | null
  currency: string | null
}

/** `25.11.2026` — how a date reads in an Azerbaijani, Russian or English contract alike. */
export function contractDateText(date: Date): string {
  return date.toISOString().slice(0, 10).split("-").reverse().join(".")
}

/** `48 000,00` — grouped by spaces, two decimals after a comma, as AZ and RU documents write sums. */
export function contractAmountText(amount: number): string {
  const [whole, cents] = amount.toFixed(2).split(".")
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${cents}`
}

/** Every standard field that has a value, as text. A field without a value is absent, not "". */
export function standardValues(input: StandardInput): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [key, read] of PARTY_FIELDS) {
    const ours = read(input.our)
    const theirs = read(input.counterparty)
    if (ours) values[`our_${key}`] = ours
    if (theirs) values[`counterparty_${key}`] = theirs
  }
  values.contract_date = contractDateText(input.date)
  if (input.amount !== null && Number.isFinite(input.amount)) values.contract_amount = contractAmountText(input.amount)
  if (input.currency) values.contract_currency = input.currency
  return values
}

export interface TemplateFill {
  /** What goes to the substituter, typed as each variable declares. */
  values: Record<string, string | number | boolean>
  /** Variables filled by the wizard, and where from. */
  filled: Array<{ name: string; source: "standard" | "default" | "typed" }>
  /** Required variables nobody filled yet — the wizard's step 3 asks for these. */
  missing: string[]
  /** Variables a person fills: not standard, or standard with no value here. */
  asked: TemplateVariable[]
}

/**
 * The values for a template's variables: standard ones from the parties and
 * the deal, then what a person typed, then the template's defaults. What a
 * person typed wins over a default; a standard value wins over what was typed,
 * because it is the card's and the registry's, and the preview shows it.
 */
export function fillTemplate(
  variables: readonly TemplateVariable[],
  standard: Record<string, string>,
  typed: Record<string, string | number | boolean>,
  input: Pick<StandardInput, "date" | "amount">,
): TemplateFill {
  const values: TemplateFill["values"] = {}
  const filled: TemplateFill["filled"] = []
  const missing: string[] = []
  const asked: TemplateVariable[] = []
  for (const variable of variables) {
    const name = variable.name
    const standardValue = typedStandard(variable, standard[name], input)
    if (standardValue !== undefined) {
      values[name] = standardValue
      filled.push({ name, source: "standard" })
      continue
    }
    asked.push(variable)
    const own = typed[name]
    if (own !== undefined && own !== "") {
      values[name] = own
      filled.push({ name, source: "typed" })
    } else if (variable.default !== undefined) {
      filled.push({ name, source: "default" })
    } else if (variable.required) {
      missing.push(name)
    }
  }
  return { values, filled, missing, asked }
}

/** A standard value in the type its variable declares; undefined when it cannot be one. */
function typedStandard(
  variable: TemplateVariable,
  text: string | undefined,
  input: Pick<StandardInput, "date" | "amount">,
): string | number | boolean | undefined {
  if (text === undefined) return undefined
  if (variable.type === "string") return text
  if (variable.type === "number" && variable.name === "contract_amount" && input.amount !== null) return input.amount
  if (variable.type === "date" && variable.name === "contract_date") return input.date.toISOString().slice(0, 10)
  return undefined
}

/** Does any clause already name the other side's requisites? Then no block is added. */
export function templateNamesCounterparty(clauses: readonly Pick<TemplateClause, "body">[]): boolean {
  return clauses.some((clause) => /\{\{\s*counterparty_(voen|iban|bank_name|address)\s*\}\}/.test(clause.body))
}

const BLOCK_WORDS: Record<FieldLang, Record<string, string>> = {
  az: { title: "TƏRƏFLƏRİN REKVİZİTLƏRİ", voen: "VÖEN", address: "Ünvan", director: "Direktor", bank: "Bank", code: "Kod", swift: "SWIFT", iban: "H/h", bankVoen: "Bankın VÖEN-i", corr: "M/h" },
  ru: { title: "РЕКВИЗИТЫ СТОРОН", voen: "VÖEN", address: "Адрес", director: "Директор", bank: "Банк", code: "Код", swift: "SWIFT", iban: "Р/с", bankVoen: "VÖEN банка", corr: "К/с" },
  en: { title: "DETAILS OF THE PARTIES", voen: "Tax ID (VÖEN)", address: "Address", director: "Director", bank: "Bank", code: "Code", swift: "SWIFT", iban: "Account (IBAN)", bankVoen: "Bank tax ID", corr: "Corr. account" },
}

function partyLines(party: ContractParty, w: Record<string, string>): string[] {
  const rows: Array<[string, string | null]> = [
    [w.voen, party.voen],
    [w.address, party.address],
    [w.director, party.director],
    [w.bank, party.bank.bankName],
    [w.code, party.bank.bankCode],
    [w.swift, party.bank.bankSwift],
    [w.iban, party.bank.bankAccount],
    [w.bankVoen, party.bank.bankVoen],
    [w.corr, party.bank.bankCorrAccount],
  ]
  return [party.name, ...rows.filter(([, value]) => Boolean(value)).map(([label, value]) => `${label}: ${value}`)]
}

/**
 * «Tərəflərin rekvizitləri» — the closing section every contract here carries,
 * written once instead of in every template. Plain text, one party after the
 * other, so the PDF and the editor show it the same way.
 */
export function requisitesBlock(our: ContractParty, counterparty: ContractParty, lang: FieldLang): string {
  const w = BLOCK_WORDS[lang]
  return [w.title, partyLines(our, w).join("\n"), partyLines(counterparty, w).join("\n")].join("\n\n")
}
