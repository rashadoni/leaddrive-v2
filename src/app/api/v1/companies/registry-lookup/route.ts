/**
 * POST { voen, exclude? } — «VÖEN ilə doldur»: the company's card from the tax
 * registry, plus another company of this organization with the same VÖEN.
 * Nothing is written: the form shows the card and copies it on «Formaya köçür».
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { withRlsAuth } from "@/lib/with-rls"
import { lookupTaxpayer, normaliseVoen, RegistryUnavailableError } from "@/lib/companies/az-taxpayer-registry"
import { companyWithVoen } from "@/lib/companies/voen-duplicate"

const bodySchema = z.object({ voen: z.string().max(40), exclude: z.string().max(60).nullable().optional() }).strict()

export const POST = withRlsAuth("companies", "write", async (req, { orgId }) => {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  const voen = parsed.success ? normaliseVoen(parsed.data.voen) : null
  if (!parsed.success || !voen) return NextResponse.json({ error: "VÖEN is ten digits", code: "INVALID_VOEN" }, { status: 400 })

  const duplicate = await companyWithVoen(orgId, voen, parsed.data.exclude)
  try {
    const card = await lookupTaxpayer(voen)
    if (!card) return NextResponse.json({ error: "Not in the registry", code: "NOT_FOUND", duplicate }, { status: 404 })
    return NextResponse.json({ success: true, data: { card, duplicate } })
  } catch (error) {
    if (!(error instanceof RegistryUnavailableError)) throw error
    console.warn("[registry-lookup] unavailable", error.message)
    return NextResponse.json({ error: "Registry unavailable", code: "REGISTRY_UNAVAILABLE", duplicate }, { status: 502 })
  }
})
