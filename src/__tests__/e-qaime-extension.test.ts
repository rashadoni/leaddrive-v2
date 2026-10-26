/**
 * The LeadDrive e-Qaimə Chrome extension (extensions/e-qaime/).
 *
 * What is held here:
 *   - the zip Finance → «E-qaimə» offers is built from these very sources;
 *   - the extension asks for no more than the tax portal and LeadDrive, and the
 *     portal's pass never reaches the part that talks to LeadDrive;
 *   - a period is read month by month, with the dates the portal expects;
 *   - a portal card becomes the invoice LeadDrive's import takes, with the
 *     18 % base passed on as the base (not as the tax);
 *   - a second reading opens only the new invoices and those whose status
 *     changed, and fetches only the missing PDFs.
 */
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { eQaimeInvoiceSchema, eQaimeTotals } from "@/lib/finance/e-qaime"

const ROOT = process.cwd()
const EXT = path.join(ROOT, "extensions/e-qaime")
const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = require(path.join(EXT, "core.js"))

describe("the downloadable extension", () => {
  it("public/downloads/leaddrive-e-qaime.zip is built from extensions/e-qaime", async () => {
    const pack = await import(/* @vite-ignore */ path.join(ROOT, "scripts/e-qaime-extension/pack.mjs"))
    const fresh: Buffer = await pack.buildZip()
    const shipped = readFileSync(path.join(ROOT, "public/downloads/leaddrive-e-qaime.zip"))
    expect(
      shipped.equals(fresh),
      "The zip is stale: run node scripts/e-qaime-extension/pack.mjs and commit public/downloads/leaddrive-e-qaime.zip",
    ).toBe(true)
  })

  it("asks only for the tax portal and LeadDrive", () => {
    const manifest = JSON.parse(readFileSync(path.join(EXT, "manifest.json"), "utf8"))
    expect(manifest.manifest_version).toBe(3)
    expect(manifest.permissions).toEqual(["storage"])
    expect(manifest.host_permissions).toEqual([
      "https://new.e-taxes.gov.az/*",
      "https://*.leaddrivecrm.org/*",
      "http://localhost:3000/*",
    ])
    const scripts = manifest.content_scripts.map((s: { matches: string[]; js: string[] }) => [s.matches, s.js])
    expect(scripts).toEqual([
      [["https://new.e-taxes.gov.az/*"], ["core.js", "etaxes.js"]],
      [["https://*.leaddrivecrm.org/*", "http://localhost:3000/*"], ["leaddrive.js"]],
    ])
  })

  it("the portal's pass stays in the portal's tab", () => {
    // background.js and leaddrive.js are what talks to LeadDrive: neither may
    // read, carry or name the portal's pass.
    for (const file of ["background.js", "leaddrive.js"]) {
      const source = readFileSync(path.join(EXT, file), "utf8")
      expect(source, file).not.toMatch(/aztax-jwt|TOKEN_KEY|x-authorization|localStorage/)
    }
    // And the portal's page sends LeadDrive invoices, never the pass itself.
    const portalPage = readFileSync(path.join(EXT, "etaxes.js"), "utf8")
    const toBackground = portalPage.match(/sendMessage\(\{[^}]*\}/g) ?? []
    expect(toBackground.join("\n")).not.toMatch(/token|claims|jwt/i)
  })
})

describe("asking the portal", () => {
  it("cuts a period into calendar months, both ends inclusive", () => {
    expect(core.monthChunks("2026-09-15", "2026-11-03")).toEqual([
      { from: "2026-09-15", to: "2026-09-30" },
      { from: "2026-10-01", to: "2026-10-31" },
      { from: "2026-11-01", to: "2026-11-03" },
    ])
    expect(core.monthChunks("2026-11-03", "2026-09-15")).toEqual([])
    expect(core.dayChunks("2026-02-27", "2026-03-01").map((c: { from: string }) => c.from)).toEqual(["2026-02-27", "2026-02-28", "2026-03-01"])
  })

  it("sends the dates as the portal writes them, the end being the next day", () => {
    const body = core.searchBody("outbox", { from: "2026-10-01", to: "2026-10-31" }, 50)
    expect(body.creationDateFrom).toBe("01-10-2026 00:00")
    expect(body.creationDateTo).toBe("01-11-2026 00:00")
    expect(body.offset).toBe(50)
    expect(body.maxCount).toBe(50)
    expect(body.types).toEqual(["current", "corrected"])
  })

  it("names the statuses and kinds as the portal's own list does, cancellations included", () => {
    // Seen on the live portal 2026-10-26: its list sends both fields, and it
    // refuses status words it does not know ("cancelled" → HTTP 400; its word is "canceled").
    const body = core.searchBody("inbox", { from: "2026-10-01", to: "2026-10-31" }, 0)
    expect(body.statuses).toEqual(expect.arrayContaining(["approved", "onApproval", "approvedBySystem", "canceled", "deleted"]))
    expect(body.statuses).not.toContain("cancelled")
    expect(body.statuses).not.toContain("rejected")
    expect(body.kinds).toEqual(expect.arrayContaining(["defaultInvoice", "advanceInvoice", "returnInvoice", "resale", "exportNoteInvoice"]))
    expect(body.kinds).toHaveLength(12)
  })

  it("names a sole proprietor, whose pass has no organization name", () => {
    expect(core.ownCompany({ voen: "1601175582", organizationName: null, fullName: "Rəşad Rəhimov" })).toEqual({ voen: "1601175582", name: "Rəşad Rəhimov" })
    expect(core.ownCompany({ voen: "1400000000", organizationName: "Nümunə MMC", fullName: "X" })).toEqual({ voen: "1400000000", name: "Nümunə MMC" })
    expect(core.ownCompany({ voen: "abc" })).toBeNull()
  })

  it("reads the company from the portal's pass", () => {
    const payload = Buffer.from(JSON.stringify({ voen: "1400000000", organizationName: "Nümunə MMC", exp: 1 })).toString("base64url")
    expect(core.tokenClaims(`Bearer x.${payload}.y`)).toMatchObject({ voen: "1400000000", organizationName: "Nümunə MMC" })
  })
})

describe("a portal card becomes an import", () => {
  const listed = { id: 9001, serialNumber: "MT261024318807", status: "approved", sourceSystem: "avis" }
  const card = {
    id: 9001,
    serialNumber: "mt261024318807",
    kind: "defaultInvoice",
    type: "current",
    status: "approved",
    createdAt: "24-10-2026 10:15:00",
    sender: { tin: 1700000011, name: "Gəncə Kərpic ASC" },
    receiver: { tin: "1400000000", name: "Nümunə MMC" },
    invoiceComment: "34 nömrəli 21.09.2026 tarixli müqavilə",
    items: [
      { productName: "Kərpic", productGroup: { code: "6904100000", type: "good" }, unit: "ədəd", quantity: 1000, pricePerUnit: 0.2227, cost: 222.711876, vat18: 222.711876 },
      { productName: "Daşınma", productGroup: { code: 4900000000, type: "service" }, unit: "xidmət", quantity: 1, pricePerUnit: 50, cost: 50, vatFree: 50, sourceInvoiceInfo: { serialNumber: "MT261007000001" } },
    ],
  }

  it("carries what LeadDrive needs, and LeadDrive's import takes it", () => {
    const invoice = core.importInvoice(listed, card, "inbox")
    expect(invoice).toMatchObject({
      portalId: "9001",
      direction: "inbox",
      serialNumber: "MT261024318807",
      kind: "defaultInvoice",
      docType: "current",
      sender: { voen: "1700000011", name: "Gəncə Kərpic ASC" },
      receiver: { voen: "1400000000", name: "Nümunə MMC" },
      sourceSerials: ["MT261007000001"],
    })
    expect(new Date(invoice.issuedAt).getDate()).toBe(24)
    expect(invoice.items[0]).toMatchObject({ code: "6904100000", cost: 222.711876, vat18: 222.711876, vatFree: null })
    expect(invoice.items[1]).toMatchObject({ code: "4900000000", productType: "service", vatFree: 50, vat18: null })

    const parsed = eQaimeInvoiceSchema.parse(invoice)
    const totals = eQaimeTotals(parsed.items)
    // 18 % of the 18 % base, not of the whole: 222.711876 × 0.18.
    expect(totals.vat.toString()).toBe("40.088138")
    expect(totals.net.toString()).toBe("272.711876")
    expect(totals.total.toString()).toBe("312.800014")
  })
})

describe("a second reading", () => {
  it("opens the new and the changed, and fetches only the missing PDFs", () => {
    const listed = [
      { id: 1, status: "approved" },
      { id: 2, status: "approved" },
      { id: 3, status: "cancelled" },
      { id: 4, status: "approved" },
    ]
    const known = [
      { portalId: "2", status: "approved", hasPdf: true, id: "row-2" },
      { portalId: "3", status: "approved", hasPdf: true, id: "row-3" },
      { portalId: "4", status: "approved", hasPdf: false, id: "row-4" },
    ]
    const plan = core.plan(listed, known)
    expect(plan.open.map((i: { id: number }) => i.id)).toEqual([1, 3])
    expect(plan.pdfOnly).toEqual([{ item: { id: 4, status: "approved" }, id: "row-4" }])
  })
})
