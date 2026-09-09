/**
 * Build a Prisma WHERE clause from segment conditions.
 * Shared between preview API and dynamic segment recalculation.
 */
export function buildContactWhere(orgId: string, conditions: Record<string, any>) {
  const where: any = { organizationId: orgId }
  const AND: any[] = []

  // === FIELD-BASED CONDITIONS ===

  if (conditions.company?.trim()) {
    AND.push({ company: { name: { contains: conditions.company, mode: "insensitive" } } })
  }
  if (conditions.source && conditions.source !== "") {
    AND.push({ source: conditions.source })
  }
  if (conditions.brand?.trim()) {
    AND.push({ brand: conditions.brand.trim() })
  }
  if (conditions.category && conditions.category !== "") {
    AND.push({ category: conditions.category })
  }
  if (conditions.role?.trim()) {
    AND.push({ position: { contains: conditions.role, mode: "insensitive" } })
  }
  if (conditions.tag?.trim()) {
    AND.push({ tags: { has: conditions.tag } })
  }
  // SMS attribution — contacts who received any SMS (or a specific campaign)
  if (conditions.hasSmsAttribution || conditions.receivedSms) {
    AND.push({ lastSmsAt: { not: null } })
  }
  if (conditions.smsCampaignId) {
    AND.push({ lastSmsCampaignId: conditions.smsCampaignId })
  }
  if (conditions.smsSinceDays) {
    const days = parseInt(conditions.smsSinceDays)
    const cutoff = new Date(Date.now() - days * 86400000)
    AND.push({ lastSmsAt: { gte: cutoff } })
  }
  if (conditions.createdAfter || conditions.created_after) {
    AND.push({ createdAt: { gte: new Date(conditions.createdAfter || conditions.created_after) } })
  }
  if (conditions.createdBefore || conditions.created_before) {
    AND.push({ createdAt: { lte: new Date(conditions.createdBefore || conditions.created_before) } })
  }
  if (conditions.name?.trim()) {
    AND.push({ fullName: { contains: conditions.name, mode: "insensitive" } })
  }
  if (conditions.hasEmail || conditions.has_email) {
    AND.push({ email: { not: null } })
    AND.push({ NOT: { email: "" } })
  }
  if (conditions.hasPhone || conditions.has_phone) {
    AND.push({ phone: { not: null } })
    AND.push({ NOT: { phone: "" } })
  }

  // === BEHAVIORAL CONDITIONS ===

  // Engagement score range
  if (conditions.engagementScoreMin != null) {
    AND.push({ engagementScore: { gte: parseInt(conditions.engagementScoreMin) } })
  }
  if (conditions.engagementScoreMax != null) {
    AND.push({ engagementScore: { lte: parseInt(conditions.engagementScoreMax) } })
  }

  // Engagement tier shorthand
  if (conditions.engagementTier) {
    switch (conditions.engagementTier) {
      case "hot":
        AND.push({ engagementScore: { gte: 50 } })
        break
      case "warm":
        AND.push({ engagementScore: { gte: 20, lt: 50 } })
        break
      case "cold":
        AND.push({ engagementScore: { lt: 20 } })
        break
    }
  }

  // Last activity date range
  if (conditions.lastActivityAfter) {
    AND.push({ lastActivityAt: { gte: new Date(conditions.lastActivityAfter) } })
  }
  if (conditions.lastActivityBefore) {
    AND.push({ lastActivityAt: { lte: new Date(conditions.lastActivityBefore) } })
  }

  // Inactive for N days
  if (conditions.inactiveDays || conditions.noActivityDays) {
    const days = parseInt(conditions.inactiveDays || conditions.noActivityDays)
    const cutoff = new Date(Date.now() - days * 86400000)
    AND.push({
      OR: [
        { lastActivityAt: null },
        { lastActivityAt: { lt: cutoff } },
      ],
    })
  }

  // Has specific event type
  if (conditions.hasEventType) {
    AND.push({
      events: {
        some: {
          eventType: conditions.hasEventType,
          ...(conditions.hasEventAfter
            ? { createdAt: { gte: new Date(conditions.hasEventAfter) } }
            : {}),
        },
      },
    })
  }

  // Opened specific campaign
  if (conditions.openedCampaign) {
    AND.push({
      events: {
        some: {
          eventType: "email_opened",
          eventData: { path: ["campaignId"], equals: conditions.openedCampaign },
        },
      },
    })
  }

  // Clicked specific campaign
  if (conditions.clickedCampaign) {
    AND.push({
      events: {
        some: {
          eventType: "email_clicked",
          eventData: { path: ["campaignId"], equals: conditions.clickedCampaign },
        },
      },
    })
  }

  if (AND.length > 0) where.AND = AND
  return where
}
