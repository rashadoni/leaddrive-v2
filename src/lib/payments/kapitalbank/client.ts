/**
 * Kapital Bank e-commerce API — the two calls an invoice payment needs.
 *
 * Reference: the bank's Postman collection
 * (documenter.getpostman.com/view/14817621/2sA3dxCB1b), checked against the
 * test host on 2026-10-23.
 *
 *   POST /api/order                       create an order → { id, password, hppUrl }
 *   GET  /api/order/{id}?password=…       the order's status
 *
 * The customer pays on the bank's hosted page `${hppUrl}?id=…&password=…` and
 * is sent back to `hppRedirectUrl` with `?ID=…&STATUS=…`. The bank says those
 * query values "can be temporary": the status is always read back with the
 * GET above before anything is recorded. There is no server-to-server
 * callback, so a customer who closes the tab on the bank's page is caught up
 * by the reconcile cron (/api/cron/kapitalbank-reconcile).
 *
 * Auth is HTTP Basic with the merchant's login and password. A wrong pair is
 * reported as `InvalidLogin` on create; the status call answers "no order
 * found" either way, so only create can tell whether the keys work.
 */

export const KAPITAL_TEST_HOST = "https://txpgtst.kapitalbank.az"
export const KAPITAL_LIVE_HOST = "https://e-commerce.kapitalbank.az"

const REQUEST_TIMEOUT_MS = 15_000

export interface KapitalCredentials {
  login: string
  password: string
  isTestMode: boolean
}

export interface KapitalOrder {
  id: string
  password: string
  hppUrl: string
}

export interface KapitalOrderStatus {
  id: string
  /** Bank status word: Preparing, FullyPaid, Declined, Expired, … */
  status: string
  prevStatus: string | null
  amount: number
  currency: string
}

export class KapitalBankError extends Error {
  constructor(
    message: string,
    /** Bank error code (InvalidLogin, …), or "Network" / "BadResponse". */
    readonly code: string,
  ) {
    super(message)
    this.name = "KapitalBankError"
  }
}

export function kapitalHost(isTestMode: boolean): string {
  return isTestMode ? KAPITAL_TEST_HOST : KAPITAL_LIVE_HOST
}

/** The hosted payment page for an order. */
export function kapitalPaymentPageUrl(order: KapitalOrder): string {
  const query = new URLSearchParams({ id: order.id, password: order.password })
  return `${order.hppUrl}?${query.toString()}`
}

/** The bank takes amounts as a string with two decimals. */
export function formatKapitalAmount(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Kapital Bank amount must be positive")
  return (Math.round(amount * 100) / 100).toFixed(2)
}

async function request(
  creds: KapitalCredentials,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const auth = Buffer.from(`${creds.login}:${creds.password}`, "utf8").toString("base64")
  let response: Response
  try {
    response = await fetch(`${kapitalHost(creds.isTestMode)}${path}`, {
      method,
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    })
  } catch (error) {
    throw new KapitalBankError(error instanceof Error ? error.message : "Kapital Bank is unreachable", "Network")
  }
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null
  if (!response.ok || !json) {
    const code = typeof json?.errorCode === "string" ? json.errorCode : "BadResponse"
    const description = typeof json?.errorDescription === "string" ? json.errorDescription : `HTTP ${response.status}`
    throw new KapitalBankError(description, code)
  }
  return json
}

export async function createKapitalOrder(
  creds: KapitalCredentials,
  params: { amount: number; currency: string; description: string; language: "az" | "ru" | "en"; redirectUrl: string },
): Promise<KapitalOrder> {
  const json = await request(creds, "POST", "/api/order", {
    order: {
      typeRid: "Order_SMS",
      amount: formatKapitalAmount(params.amount),
      currency: params.currency,
      language: params.language,
      description: params.description.slice(0, 120),
      hppRedirectUrl: params.redirectUrl,
    },
  })
  const order = json.order as Record<string, unknown> | undefined
  const id = order?.id
  if (
    (typeof id !== "number" && typeof id !== "string")
    || typeof order?.password !== "string"
    || typeof order?.hppUrl !== "string"
  ) {
    throw new KapitalBankError("Kapital Bank returned an order without id, password or payment page", "BadResponse")
  }
  return { id: String(id), password: order.password, hppUrl: order.hppUrl }
}

export async function getKapitalOrderStatus(
  creds: KapitalCredentials,
  order: { id: string; password: string },
): Promise<KapitalOrderStatus> {
  const json = await request(
    creds,
    "GET",
    `/api/order/${encodeURIComponent(order.id)}?password=${encodeURIComponent(order.password)}`,
  )
  const row = json.order as Record<string, unknown> | undefined
  if (!row || typeof row.status !== "string" || typeof row.amount !== "number" || typeof row.currency !== "string") {
    throw new KapitalBankError("Kapital Bank returned an order status without status, amount or currency", "BadResponse")
  }
  return {
    id: String(row.id ?? order.id),
    status: row.status,
    prevStatus: typeof row.prevStatus === "string" ? row.prevStatus : null,
    amount: row.amount,
    currency: row.currency,
  }
}

/**
 * What a bank status means for our payment intent.
 *   paid    — the full amount was captured: FullyPaid, or Closed straight
 *             after FullyPaid ("closed after payment")
 *   failed  — the order can no longer be paid
 *   open    — not decided yet; ask again later
 * PartPaid / Refunded / Voided cannot come from an order we create (a
 * single-message purchase is captured whole or not at all) and stay open,
 * for a person to look at, rather than being guessed.
 */
export function kapitalOutcome(order: Pick<KapitalOrderStatus, "status" | "prevStatus">): "paid" | "failed" | "open" {
  if (order.status === "FullyPaid") return "paid"
  if (order.status === "Closed" && order.prevStatus === "FullyPaid") return "paid"
  if (["Declined", "Rejected", "Refused", "Expired", "Cancelled"].includes(order.status)) return "failed"
  return "open"
}
