import { NextResponse } from "next/server"
import { checkPermission, type Role } from "@/lib/permissions"

/**
 * Purchase prices, totals, costs and margins are the `procurement-costs` scope
 * (docs/sales-procurement/README.md, rule 2.5). Sales follows its purchases —
 * status, supplier, dates, quantities — and gets every money field as null, on
 * the screen and in the API alike.
 */
export function canSeeProcurementCosts(role: string): boolean {
  return checkPermission(role as Role, "procurement-costs", "read")
}

export function canWriteProcurement(role: string): boolean {
  return checkPermission(role as Role, "procurement", "write")
}

const MONEY_KEYS = new Set(["unitPrice", "total", "totalAmount", "cost", "margin", "marginPct", "revenue", "foreignCost", "spend", "purchasePrice", "plannedUnitCost", "plannedCost", "plannedMargin", "plannedMarginPct"])

/** A deep copy with every money field nulled — for a reader without `procurement-costs`. */
export function withoutPrices<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => withoutPrices(item)) as T
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = MONEY_KEYS.has(key) ? null : withoutPrices(child)
    }
    return out as T
  }
  return value
}

/** Decimal / number / string → a plain number for JSON (4-digit precision is kept by the DB). */
export function money(value: unknown): number {
  if (value === null || value === undefined) return 0
  const n = typeof value === "number" ? value : Number(String(value))
  return Number.isFinite(n) ? n : 0
}

export async function readJsonBody(req: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  try {
    return { ok: true, body: await req.json() }
  } catch {
    return { ok: false, response: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) }
  }
}

export function badRequest(message: string, code?: string): Response {
  return NextResponse.json({ error: message, ...(code ? { code } : {}) }, { status: 400 })
}

export function conflict(message: string, code: string): Response {
  return NextResponse.json({ error: message, code }, { status: 409 })
}

export function notFound(): Response {
  return NextResponse.json({ error: "Not found" }, { status: 404 })
}
