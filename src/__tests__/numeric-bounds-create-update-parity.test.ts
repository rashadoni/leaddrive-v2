import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Findings 15/16 have now reopened three times, always the same way: the bound
 * lands on the create schema and the update schema beside it keeps a bare
 * `z.number()`. Create-bounded/update-bare is not a partial fix, because the
 * caller just does both requests — `POST {budget: 0}` then
 * `PUT {budget: -999999999999}`.
 *
 * So this gate does not check that any particular field is bounded. It checks
 * PARITY: whatever the create route bounds, the update route beside it must
 * bound too. That is the invariant that keeps holding as fields are added,
 * which a hand-maintained field list does not.
 *
 * Extraction is scoped to the HEADER schema block. The first version of this
 * test collected fields file-wide and kept the first declaration of each name,
 * which silently resolved `taxRate` and `discount` to the ITEM schema declared
 * above the header — so the gate compared item bounds to item bounds and was
 * green no matter what the header did. A vacuous gate on a class that has
 * reopened three times is worse than none.
 */

type Pair = { create: string; update: string; why: string }

const PAIRS: Pair[] = [
  {
    create: "src/app/api/v1/events/route.ts",
    update: "src/app/api/v1/events/[id]/route.ts",
    why: "budget/expectedRevenue/maxParticipants were bounded on POST only",
  },
  {
    create: "src/app/api/v1/invoices/route.ts",
    update: "src/app/api/v1/invoices/[id]/route.ts",
    why: "discountValue/taxRate feed calculateInvoiceTotals",
  },
  {
    create: "src/app/api/v1/offers/route.ts",
    update: "src/app/api/v1/offers/[id]/route.ts",
    why: "header discount is copied verbatim into an invoice by from-offer",
  },
  {
    create: "src/app/api/v1/companies/route.ts",
    update: "src/app/api/v1/companies/[id]/route.ts",
    why: "creditLimit was bounded by finding 14; its neighbours were not",
  },
  {
    create: "src/app/api/v1/recurring-invoices/route.ts",
    update: "src/app/api/v1/recurring-invoices/[id]/route.ts",
    why: "the generator cron turns these rows into real invoices",
  },
]

/** Shared schemas that are bounded by construction. */
const BOUNDED_SCHEMAS = [
  "nonNegativeFinancialAmountSchema",
  "nonNegativeCountSchema",
  "coercedNonNegativeFinancialAmountSchema",
  "percentageSchema",
  "taxRateSchema",
  "leadScoreSchema",
  "nonNegativeHoursSchema",
]

const NUMERIC = new RegExp(`z\\.number\\(|${BOUNDED_SCHEMAS.join("|")}`)

/** Bounded means the range is constrained, by a chained call or a shared schema. */
function isBounded(expr: string): boolean {
  if (/\.min\(|\.nonnegative\(|\.max\(/.test(expr)) return true
  return BOUNDED_SCHEMAS.some(name => expr.includes(name))
}

/**
 * Fields of the header schema — the object an attacker posts to, as opposed to
 * the nested item schema. Blocks named `*item*` are skipped; of the rest, the
 * largest is the header (item schemas are short).
 */
function headerFields(source: string): Map<string, string> {
  const blocks: Array<{ name: string; body: string }> = []
  const declaration = /const\s+(\w+)\s*=\s*z\s*\.object\(\{/g
  let m: RegExpExecArray | null
  while ((m = declaration.exec(source)) !== null) {
    // Walk braces from the opening `{` so nested objects do not end the block.
    let depth = 1
    let i = declaration.lastIndex
    while (i < source.length && depth > 0) {
      if (source[i] === "{") depth++
      else if (source[i] === "}") depth--
      i++
    }
    blocks.push({ name: m[1], body: source.slice(declaration.lastIndex, i - 1) })
  }

  const headers = blocks.filter(b => !/item/i.test(b.name))
  if (headers.length === 0) return new Map()
  const header = headers.reduce((a, b) => (b.body.length > a.body.length ? b : a))

  const fields = new Map<string, string>()
  for (const line of header.body.split("\n")) {
    const f = line.match(/^\s*([A-Za-z_$][\w$]*)\s*:\s*(.*?),\s*$/)
    if (!f) continue
    if (!NUMERIC.test(f[2])) continue
    fields.set(f[1], f[2])
  }
  return fields
}

describe("create and update schemas agree on numeric bounds", () => {
  it.each(PAIRS)("$update matches $create ($why)", ({ create, update }) => {
    const createFields = headerFields(readFileSync(create, "utf8"))
    const updateFields = headerFields(readFileSync(update, "utf8"))

    // An update route with no parseable header schema is the worst case, not a
    // pass: recurring-invoices/[id] was raw `{...rest}` mass-assignment into a
    // table the cron turns into money, and a "no fields found → nothing to
    // compare" gate reported that as green.
    expect(
      createFields.size,
      `no numeric header fields parsed from ${create} — the gate would be vacuous`,
    ).toBeGreaterThan(0)
    expect(
      updateFields.size,
      `no numeric header fields parsed from ${update}. If the route validates ` +
      `with a zod schema this is a parser bug; if it does not validate at all, ` +
      `that is the defect — give it a schema.`,
    ).toBeGreaterThan(0)

    const unbounded: string[] = []
    for (const [name, createExpr] of createFields) {
      const updateExpr = updateFields.get(name)
      if (updateExpr === undefined) continue // not updatable — nothing to check
      if (isBounded(createExpr) && !isBounded(updateExpr)) {
        unbounded.push(`${name}: create=\`${createExpr}\` update=\`${updateExpr}\``)
      }
    }

    expect(
      unbounded,
      `${update} accepts numeric fields that ${create} bounds. Create-bounded and ` +
      `update-bare is no protection at all — the caller just does both requests. ` +
      `Use the shared schemas in src/lib/validation/numeric.ts.`,
    ).toEqual([])
  })

  // Parity is silent about a field neither side bounds, so the ones that move
  // money are pinned by name — on the HEADER schema, which is what the earlier
  // version of this test failed to do.
  it.each([
    ["src/app/api/v1/invoices/route.ts", "discountValue"],
    ["src/app/api/v1/invoices/route.ts", "taxRate"],
    ["src/app/api/v1/invoices/[id]/route.ts", "discountValue"],
    ["src/app/api/v1/invoices/[id]/route.ts", "taxRate"],
    ["src/app/api/v1/offers/route.ts", "discount"],
    ["src/app/api/v1/offers/[id]/route.ts", "discount"],
    ["src/app/api/v1/recurring-invoices/route.ts", "taxRate"],
    ["src/app/api/v1/recurring-invoices/[id]/route.ts", "taxRate"],
  ])("%s bounds %s on the header schema", (path, field) => {
    const expr = headerFields(readFileSync(path, "utf8")).get(field)
    expect(expr, `${field} not found on the header schema of ${path}`).toBeDefined()
    expect(isBounded(expr as string), `${field} is unbounded: \`${expr}\``).toBe(true)
  })

  it("the deal product line is validated at all", () => {
    // This route destructured `price` straight out of the JSON body and pushed
    // it into deal.metadata.products[] — no schema, so -99999, "abc", {} and
    // 1e308 all persisted and were read back by GET.
    const source = readFileSync("src/app/api/v1/deals/[id]/products/route.ts", "utf8")
    expect(source).toMatch(/safeParse/)
    expect(headerFields(source).get("price")).toBe("nonNegativeFinancialAmountSchema")
  })

  // The discount check needs the subtotal, and on update it must run whether or
  // not the request carries items — `discountValue` reaches the row through
  // `...rest` either way. Placing it inside `if (items)` made it skippable.
  it("the invoice update validates the discount before it writes anything", () => {
    const source = readFileSync("src/app/api/v1/invoices/[id]/route.ts", "utf8")
    const checkAt = source.indexOf("invoiceDiscountError(")
    const updateDataAt = source.indexOf("const updateData")
    expect(checkAt).toBeGreaterThan(-1)
    expect(
      checkAt,
      "invoiceDiscountError must run before updateData is assembled, not inside `if (items)`",
    ).toBeLessThan(updateDataAt)
  })
})
