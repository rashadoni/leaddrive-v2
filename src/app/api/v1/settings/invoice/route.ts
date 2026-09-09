import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { DEFAULT_CURRENCY } from "@/lib/constants"
import { withRls, withRlsAuth } from "@/lib/with-rls"

const invoiceSettingsSchema = z.object({
  numberPrefix: z.string().max(20).optional(),
  defaultPaymentTerms: z.string().max(50).optional(),
  defaultTaxRate: z.number().min(0).max(1).optional(),
  defaultCurrency: z.string().max(10).optional(),
  companyName: z.string().max(200).optional(),
  companyAddress: z.string().max(500).optional(),
  companyVoen: z.string().max(50).optional(),
  companyLogoUrl: z.string().max(500).optional(),
  companyPhone: z.string().max(50).optional(),
  companyEmail: z.string().max(200).optional(),
  directorName: z.string().max(200).optional(),
  directorTitle: z.string().max(100).optional(),
  bankName: z.string().max(200).optional(),
  bankCode: z.string().max(50).optional(),
  bankSwift: z.string().max(20).optional(),
  bankAccount: z.string().max(50).optional(),
  bankVoen: z.string().max(50).optional(),
  bankCorrAccount: z.string().max(50).optional(),
  footerNote: z.string().max(1000).optional(),
  termsAndConditions: z.string().max(5000).optional(),
}).strict()

export const GET = withRls(async (_req, { orgId }) => {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { settings: true },
    })

    const settings = (org?.settings as Record<string, unknown>) || {}
    const invoiceSettings = (settings.invoice as Record<string, unknown>) || {
      numberPrefix: "INV-",
      defaultPaymentTerms: "net30",
      defaultTaxRate: 0.18,
      defaultCurrency: DEFAULT_CURRENCY,
      companyName: "",
      companyAddress: "",
      companyVoen: "",
      companyLogoUrl: "",
      companyPhone: "",
      companyEmail: "",
      directorName: "",
      directorTitle: "Direktor",
      bankName: "",
      bankCode: "",
      bankSwift: "",
      bankAccount: "",
      bankVoen: "",
      bankCorrAccount: "",
      footerNote: "",
      termsAndConditions: "",
    }

    return NextResponse.json({ success: true, data: invoiceSettings })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const PUT = withRlsAuth("settings", "write", async (req: NextRequest, authResult) => {
  const orgId = authResult.orgId

  try {
    const body = await req.json()
    const parsed = invoiceSettingsSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { settings: true },
    })

    const settings = (org?.settings as Record<string, unknown>) || {}
    settings.invoice = parsed.data

    await prisma.organization.update({
      where: { id: orgId },
      data: { settings },
    })

    return NextResponse.json({ success: true, data: parsed.data })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
