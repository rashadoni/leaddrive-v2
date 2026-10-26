/*
 * LeadDrive e-Qaimə — the parts that do not touch the browser: how the tax
 * portal is asked and what its answers turn into. Loaded before etaxes.js on
 * the portal's pages, and by the LeadDrive tests through `module.exports`.
 *
 * Facts about new.e-taxes.gov.az this file relies on (its own web pages make
 * the same requests; there is no published API):
 *   - after the sign-in the page keeps a short-lived pass (about ten minutes)
 *     in localStorage "aztax-jwt", sent as `x-authorization: Bearer …`;
 *   - a search answers at most 10 000 invoices, and a very wide period may
 *     fail outright, so a period is read a month at a time, and a month that
 *     still overflows is split into days;
 *   - dates are sent as "DD-MM-YYYY 00:00", the end being the next day;
 *   - the invoice number filter, when given, is an array;
 *   - a search names the statuses and the kinds it wants, as the portal's own
 *     list does (seen on its «Elektron qaimə-fakturalar» screen, 2026-10-26).
 *     The portal checks the status words: a cancelled invoice is "canceled",
 *     and "cancelled", "rejected" or "cancelledBySystem" are refused (HTTP 400).
 */
(function (root, factory) {
  const api = factory()
  if (typeof module === "object" && module.exports) module.exports = api
  else root.LeadDriveEqaimeCore = api
})(typeof self !== "undefined" ? self : this, function () {
  "use strict"

  const PORTAL = "https://new.e-taxes.gov.az"
  const API = PORTAL + "/api/po/invoice/public/v2"
  const RENEW_URL = PORTAL + "/api/po/auth/public/v1/renew"
  const TOKEN_KEY = "aztax-jwt"
  const PAGE_SIZE = 50
  const OFFSET_LIMIT = 10000
  /** The portal's own list asks for these; "canceled" and "deleted" are added so that a cancellation reaches LeadDrive too. */
  const STATUSES = ["approved", "onApproval", "updateApproval", "updateRequested", "cancelRequested", "approvedBySystem",
    "onApprovalEdited", "deactivated", "cancelationRefused", "correctionRefused", "canceled", "deleted"]
  const KINDS = ["defaultInvoice", "agent", "resale", "recycling", "taxCodex163", "taxCodex177_5", "returnInvoice",
    "returnByAgent", "returnRecycled", "exportNoteInvoice", "exciseGoodsTransfer", "advanceInvoice"]
  /** The new system starts here; earlier invoices live in another section. */
  const FIRST_DAY = "2020-01-01"

  const pad = (n) => String(n).padStart(2, "0")
  /** "YYYY-MM-DD" → local Date at midnight; null when it is not a real day. */
  function parseDay(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""))
    if (!m) return null
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null
  }
  const ymd = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
  /** The portal's date: "DD-MM-YYYY 00:00". */
  const portalDate = (d) => pad(d.getDate()) + "-" + pad(d.getMonth() + 1) + "-" + d.getFullYear() + " 00:00"

  /** The period cut into calendar months: [{ from, to }] as "YYYY-MM-DD", both ends inclusive. */
  function monthChunks(from, to) {
    const start = parseDay(from)
    const end = parseDay(to)
    if (!start || !end || start > end) return []
    const out = []
    let cursor = start
    while (cursor <= end) {
      const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)
      const last = monthEnd < end ? monthEnd : end
      out.push({ from: ymd(cursor), to: ymd(last) })
      cursor = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1)
    }
    return out
  }

  /** Every day of a chunk, for a month with more invoices than one search returns. */
  function dayChunks(from, to) {
    const start = parseDay(from)
    const end = parseDay(to)
    const out = []
    for (let d = start; d && end && d <= end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      out.push({ from: ymd(d), to: ymd(d) })
    }
    return out
  }

  /** The body of one page of a search. `direction`: "inbox" | "outbox". */
  function searchBody(direction, chunk, offset) {
    const start = parseDay(chunk.from)
    const end = parseDay(chunk.to)
    const after = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1)
    return {
      sortBy: "creationDate",
      sortAsc: true,
      statuses: STATUSES,
      types: ["current", "corrected"],
      kinds: KINDS,
      creationDateFrom: portalDate(start),
      creationDateTo: portalDate(after),
      actionOwner: null,
      amountFrom: null,
      amountTo: null,
      maxCount: PAGE_SIZE,
      offset: offset,
      productCode: null,
      productName: null,
      receiverName: null,
      receiverTin: null,
      senderName: null,
      senderTin: null,
      serialNumber: null,
    }
  }

  /** The invoices of a search answer, wherever the portal put them. */
  function listOf(answer) {
    if (Array.isArray(answer)) return answer
    for (const key of ["invoices", "items"]) {
      if (answer && Array.isArray(answer[key])) return answer[key]
      if (answer && answer.data && Array.isArray(answer.data[key])) return answer.data[key]
    }
    return []
  }

  /** The total a search reports, or null. */
  function totalOf(answer) {
    const candidates = [answer && answer.totalCount, answer && answer.total, answer && answer.count,
      answer && answer.data && answer.data.totalCount, answer && answer.data && answer.data.total]
    for (const value of candidates) if (Number.isFinite(Number(value)) && value !== null && value !== "") return Number(value)
    return null
  }

  /**
   * The company in the portal's pass. A sole proprietor's pass has no
   * organizationName (seen 2026-10-26): the name is then the person's.
   */
  function ownCompany(claims) {
    const voen = String((claims && claims.voen) || "")
    if (!/^\d{10}$/.test(voen)) return null
    const name = String(claims.organizationName || claims.fullName || claims.individualName || voen).trim()
    return { voen: voen, name: name || voen }
  }

  /** The claims of the portal's pass: voen, organizationName, fullName, exp … */
  function tokenClaims(token) {
    const part = String(token || "").replace(/^Bearer\s+/i, "").split(".")[1] || ""
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/")
    const padded = b64 + "===".slice((b64.length + 3) % 4)
    const bin = atob(padded)
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes))
  }

  /** The portal's date (ISO, perhaps without a zone, read as the accountant's clock) → ISO with zone. */
  function isoOf(value) {
    const text = String(value || "")
    const dmy = /^(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(text)
    const date = dmy
      ? new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]), Number(dmy[4] || 0), Number(dmy[5] || 0), Number(dmy[6] || 0))
      : new Date(text)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }

  const num = (v) => (v === null || v === undefined || v === "" ? null : v)

  /** A serial number from a string or an object that carries one. */
  const serialOf = (x) => (typeof x === "string" ? x : x && x.serialNumber ? String(x.serialNumber) : null)

  /**
   * An invoice for LeadDrive's import, from the portal's full card of it and
   * the line it had in the search. Numbers are passed on as the portal wrote
   * them; LeadDrive sums them itself.
   */
  function importInvoice(listed, detail, direction) {
    const d = detail || {}
    const items = Array.isArray(d.items) ? d.items : []
    const fromItems = items.map((i) => serialOf(i && i.sourceInvoiceInfo)).filter(Boolean)
    const fromInvoice = (Array.isArray(d.sourceInvoices) ? d.sourceInvoices : []).map(serialOf).filter(Boolean)
    const party = (p) => ({ voen: p && p.tin != null ? String(p.tin) : null, name: (p && p.name) || "" })
    return {
      portalId: String(listed.id || d.id),
      priorSystem: false,
      sourceSystem: listed.sourceSystem || d.sourceSystem || "avis",
      direction: direction,
      serialNumber: String(d.serialNumber || listed.serialNumber || "").toUpperCase(),
      kind: d.kind || listed.kind || null,
      docType: d.type || listed.type || null,
      status: d.status || listed.status || "unknown",
      issuedAt: isoOf(d.createdAt || d.creationDate || listed.createdAt || listed.creationDate),
      sender: party(d.sender || listed.sender),
      receiver: party(d.receiver || listed.receiver),
      comment: d.invoiceComment || null,
      comment2: d.invoiceComment2 || null,
      sourceSerials: Array.from(new Set(fromInvoice.concat(fromItems))).slice(0, 50),
      items: items.map((i) => ({
        name: i.productName || "",
        code: i.productGroup && i.productGroup.code != null ? String(i.productGroup.code) : null,
        productType: (i.productGroup && i.productGroup.type) || null,
        unit: i.unit || null,
        quantity: num(i.quantity),
        price: num(i.pricePerUnit),
        cost: num(i.cost) ?? 0,
        vat18: num(i.vat18),
        vat0: num(i.vat0),
        vatFree: num(i.vatFree),
        exempt: num(i.exempt),
        excise: num(i.excise),
        exciseRate: num(i.exciseRate),
        roadTax: num(i.roadTax),
        sourceSerial: serialOf(i.sourceInvoiceInfo),
      })),
    }
  }

  /** What to do with each listed invoice, given what LeadDrive already holds. */
  function plan(listed, known) {
    const byId = new Map((known || []).map((k) => [String(k.portalId), k]))
    const open = []
    const pdfOnly = []
    for (const item of listed) {
      const have = byId.get(String(item.id))
      if (!have || (item.status && item.status !== have.status)) open.push(item)
      else if (!have.hasPdf) pdfOnly.push({ item: item, id: have.id })
    }
    return { open: open, pdfOnly: pdfOnly }
  }

  /** The default period: the first day of last month to today (late approvals land there). */
  function defaultPeriod(today) {
    const now = today || new Date()
    return { from: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: ymd(now) }
  }

  function bytesToBase64(bytes) {
    let binary = ""
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
    return btoa(binary)
  }

  return {
    PORTAL, API, RENEW_URL, TOKEN_KEY, PAGE_SIZE, OFFSET_LIMIT, FIRST_DAY, STATUSES, KINDS, ownCompany,
    parseDay, ymd, portalDate, monthChunks, dayChunks, searchBody, listOf, totalOf,
    tokenClaims, isoOf, importInvoice, plan, defaultPeriod, bytesToBase64,
  }
})
