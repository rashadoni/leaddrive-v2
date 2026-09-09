import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { decimalToNumber } from "@/lib/prisma-decimal"

export const POST = withRls(async (req, { orgId }) => {
  const body = await req.json()
  const { contactId, dealId } = body

  // Get all products
  const products = await prisma.product.findMany({
    where: { organizationId: orgId, isActive: true },
    orderBy: { name: "asc" },
  })

  if (products.length === 0) {
    return NextResponse.json({ success: true, data: { recommendations: [], message: "No products available" } })
  }

  // Build context from deal or contact
  let contextParts: string[] = []
  let dealValue = 0
  let companyName = ""
  let industry = ""

  if (dealId) {
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, organizationId: orgId },
      include: {
        company: { select: { name: true, industry: true, category: true, userCount: true } },
      },
    })
    if (deal) {
      contextParts.push(deal.name || "")
      contextParts.push(deal.customerNeed || "")
      contextParts.push(deal.salesChannel || "")
      contextParts.push(deal.notes || "")
      dealValue = decimalToNumber(deal.valueAmount)
      if (deal.company) {
        companyName = deal.company.name
        industry = deal.company.industry || ""
        contextParts.push(deal.company.name, deal.company.industry || "", deal.company.category || "")
      }
      // Fetch contact separately (no relation in schema)
      if (deal.contactId) {
        const contact = await prisma.contact.findFirst({
          where: { id: deal.contactId },
          select: { fullName: true, position: true, department: true },
        })
        if (contact) contextParts.push(contact.position || "", contact.department || "")
      }
    }
  }

  if (contactId) {
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, organizationId: orgId },
      include: { company: { select: { name: true, industry: true } } },
    })
    if (contact) {
      contextParts.push(contact.position || "", contact.department || "", contact.source || "")
      if (contact.company) {
        companyName = contact.company.name
        industry = contact.company.industry || ""
        contextParts.push(contact.company.name, contact.company.industry || "")
      }
    }

    // Also get contact's deals
    const deals = await prisma.deal.findMany({
      where: { organizationId: orgId, contactId },
      select: { name: true, valueAmount: true, customerNeed: true },
    })
    deals.forEach((d: any) => {
      contextParts.push(d.customerNeed || "", d.name || "")
      dealValue = Math.max(dealValue, decimalToNumber(d.valueAmount))
    })
  }

  const contextStr = contextParts.filter(Boolean).join(" ").toLowerCase()

  // Smart scoring
  const scored = products.map((product: any) => {
    let score = 40 // base score

    // Tag matching (high signal)
    for (const tag of product.tags) {
      if (contextStr.includes(tag.toLowerCase())) score += 18
    }

    // Feature matching
    for (const feat of product.features) {
      const words = feat.toLowerCase().split(/\s+/)
      for (const w of words) {
        if (w.length > 3 && contextStr.includes(w)) { score += 8; break }
      }
    }

    // Category/name matching
    const nameWords = product.name.toLowerCase().split(/\s+/)
    for (const w of nameWords) {
      if (w.length > 3 && contextStr.includes(w)) score += 12
    }

    // Industry matching
    if (industry) {
      const indLower = industry.toLowerCase()
      if (product.tags.some((t: string) => indLower.includes(t.toLowerCase()))) score += 15
      if (product.name.toLowerCase().includes(indLower) || (product.description || "").toLowerCase().includes(indLower)) score += 10
    }

    // Price fit
    if (dealValue > 10000 && product.price > 3000) score += 8
    else if (dealValue > 5000 && product.price > 1000) score += 6
    else if (dealValue < 3000 && product.price < 2000) score += 6

    // Deal context bonus
    if (contextStr.length > 50) score += 5

    // Generate reason. `reasonKey` + `company` let the client localize the text
    // (the threshold logic stays here, the single source of truth); `reason` is
    // the pre-rendered English string kept for backward compatibility.
    let reasonKey: "high" | "good" | "upsell" | "base" = "base"
    let reason = "Recommended based on your company profile."
    if (score >= 80) {
      reasonKey = "high"
      reason = `High relevance for ${companyName || "this client"} — product features align with deal requirements and industry profile.`
    } else if (score >= 60) {
      reasonKey = "good"
      reason = `Good fit for ${companyName || "this client"} — matches several criteria including company size and service needs.`
    } else if (score >= 45) {
      reasonKey = "upsell"
      reason = `Potential upsell for ${companyName || "this client"} — complementary to current services.`
    }

    return {
      productId: product.id,
      name: product.name,
      description: product.description,
      category: product.category,
      price: product.price,
      currency: product.currency,
      features: product.features,
      score: Math.min(score, 99),
      reasonKey,
      company: companyName || "",
      reason,
    }
  })

  scored.sort((a: any, b: any) => b.score - a.score)

  return NextResponse.json({
    success: true,
    data: { recommendations: scored.slice(0, 5) },
  })
})
