import { prisma } from "@/lib/prisma"
import { DEFAULT_CURRENCY } from "@/lib/currency"

/**
 * The currency an organisation works in — what a new invoice, offer, deal or
 * product starts in.
 *
 * Browser code used `DEFAULT_CURRENCY` for this, i.e.
 * `process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || "USD"`. Next.js inlines
 * NEXT_PUBLIC_* at BUILD time and the deploy build never set it, so in the
 * browser it was "USD" while the server (PM2 env) read "AZN" — verified in the
 * live chunks on 2026-09-22. A new invoice started in dollars even in the one
 * organisation that had set «Default currency: AZN» in Invoice settings, which
 * no form read.
 *
 * Order: the default the organisation chose in Invoice settings; else its base
 * currency (the `Currency` row marked `isBase`); else the deployment's default.
 * It only picks a code — nothing is converted (there are no exchange rates).
 *
 * Reads tenant tables: call it inside the route's RLS context (`withRls`).
 */
export async function resolveOrgDefaultCurrency(orgId: string): Promise<string> {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } })
  const settings = (org?.settings ?? null) as Record<string, unknown> | null
  const invoice = (settings?.invoice ?? null) as Record<string, unknown> | null
  const configured = currencyCode(invoice?.defaultCurrency)
  if (configured) return configured

  const base: { code: string } | null = await prisma.currency.findFirst({
    where: { organizationId: orgId, isBase: true, isActive: true },
    select: { code: true },
  })
  return currencyCode(base?.code) ?? currencyCode(DEFAULT_CURRENCY) ?? "USD"
}

/** An ISO-4217-shaped code, upper-cased, or null. */
function currencyCode(value: unknown): string | null {
  if (typeof value !== "string") return null
  const code = value.trim().toUpperCase()
  return /^[A-Z]{3}$/.test(code) ? code : null
}
