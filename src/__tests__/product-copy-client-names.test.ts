import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Field UX audit 2026-09-05, W-01 / task C1 and Definition of Done rule 7:
 * product copy never names a customer. Every tenant sees the same screens,
 * so a customer name in a translation, a help page or a UI component leaks
 * one client's identity to all the others (the same class of defect as the
 * SOCAR / Kapital Bank references removed from proposals in PR #1074).
 *
 * QA fixtures and tests keep their names; they are not product copy.
 */
const PRODUCT_COPY_ROOTS = ["messages", "src/content", "src/components", "src/app", "src/lib"]

/**
 * Kapital Bank is also the bank invoices are paid through by card (owner,
 * 2026-10-23: «Да, это платёжный банк»). Its name is allowed where it means
 * that bank and nothing else — the card-payment integration below, the
 * `onlinePayment` texts, and the provider key / module path `kapitalbank`.
 * Anywhere else it is still a customer's name and stays out of product copy.
 */
const PAYMENT_BANK_FILES = [
  "src/lib/payments/",
  "src/app/api/v1/payment-providers/",
  "src/app/api/v1/public/invoices/",
  "src/app/api/v1/settings/online-payment/",
  "src/app/api/cron/kapitalbank-reconcile/",
  "src/components/invoices/online-payment-settings-card.tsx",
]
const PAYMENT_BANK_NAME = /kapital\s*bank/i
const CLIENT_NAMES = [/swissmed/i, /\bsocar\b/i, PAYMENT_BANK_NAME]

/** The customer names a file's product copy carries. */
function namesIn(file: string, text: string): string[] {
  const path = file.split("\\").join("/")
  let copy = text
  if (path.startsWith("messages/")) {
    const messages = JSON.parse(text) as Record<string, unknown>
    delete messages.onlinePayment
    copy = JSON.stringify(messages)
  } else {
    copy = text.replace(/\bkapitalbank\b/g, "")
  }
  const paymentBankFile = PAYMENT_BANK_FILES.some((allowed) => path.startsWith(allowed))
  return CLIENT_NAMES
    .filter((pattern) => !(paymentBankFile && pattern === PAYMENT_BANK_NAME))
    .map((pattern) => copy.match(pattern)?.[0])
    .filter((match): match is string => Boolean(match))
}

function files(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (entry === "__tests__" || entry === "node_modules") continue
    if (statSync(path).isDirectory()) files(path, out)
    else if (/\.(json|tsx?|mdx?)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(path)
  }
  return out
}

describe("product copy never names a customer", () => {
  it.each(PRODUCT_COPY_ROOTS)("%s is free of customer names", (root) => {
    const offenders: string[] = []
    for (const file of files(root)) {
      for (const name of namesIn(file, readFileSync(file, "utf8"))) offenders.push(`${file}: ${name}`)
    }
    expect(offenders).toEqual([])
  })

  it("still flags the bank's name anywhere outside the card-payment integration", () => {
    expect(namesIn("src/components/deals/proposal.tsx", "Our client Kapital Bank")).toEqual(["Kapital Bank"])
    expect(namesIn("messages/en.json", JSON.stringify({ proposals: { ref: "KapitalBank case" } }))).toEqual(["KapitalBank"])
    expect(namesIn("src/lib/payments/kapitalbank/client.ts", "Kapital Bank e-commerce API, SOCAR")).toEqual(["SOCAR"])
    expect(namesIn("messages/az.json", JSON.stringify({ onlinePayment: { settingsTitle: "Kapital Bank" } }))).toEqual([])
  })
})
