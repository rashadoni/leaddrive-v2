import { prisma } from "@/lib/prisma"

/**
 * Lead scoring — a heuristic, because the data is too small for anything else.
 *
 * WHAT WENT WRONG WITH THE PREVIOUS MODEL. It was written for leads that arrive
 * as a form with a work email and a job title, and it was measured on prod
 * against leads that arrive as chats: on 2026-08-14, 43 of 53 active leads
 * scored EXACTLY 13. A number that is the same for eighty percent of the list
 * cannot rank anything, and it was not a coincidence — every one of those leads
 * lost the same points for the same reasons:
 *
 *   30 base − 10 (no email) − 5 (no activity rows) − 5 (this source rarely
 *   converts) + 3 (long notes) = 13.
 *
 * Two of those deductions were the model punishing a lead for arriving through
 * the channel the business actually sells on. A customer who writes from TikTok
 * has no work email and never will; that is not a defect in the customer. And
 * the source penalty is circular — a channel converts poorly, so its leads are
 * ranked low, so they are worked last, so it converts poorly.
 *
 * WHAT THIS MODEL SCORES INSTEAD: whether you can reach them, whether they said
 * what they want, whether anyone has actually engaged, and above all what the
 * salesperson concluded after speaking to them. A human verdict outranks every
 * heuristic in this file, and it is the one signal that was not being read at
 * all.
 *
 * The score is stamped with `lastScoredAt` and returns its factors, so a card
 * can say WHY. Before, an unscored lead and a worthless one both rendered as
 * "0/100 (F)" — the product asserting a judgement it had never made.
 */

const FREE_EMAIL_DOMAINS = ["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "mail.ru", "yandex.ru", "icloud.com"]
const DISPOSABLE_PATTERNS = ["tempmail", "throwaway", "guerrilla", "mailinator", "yopmail", "10minute"]

// Title seniority keywords → points
const TITLE_SCORES: [RegExp, number][] = [
  [/\b(ceo|cto|cfo|coo|founder|owner|president|director|vp|vice.?president)\b/i, 20],
  [/\b(head|chief|partner|managing)\b/i, 15],
  [/\b(manager|lead|senior|principal)\b/i, 10],
  [/\b(specialist|engineer|developer|analyst|consultant)\b/i, 5],
]

/**
 * What the salesperson concluded, in points.
 *
 * Deliberately the largest term in the model. Everything else here is a guess
 * from metadata; this is a person who spoke to the customer. `sold` is not
 * scored at all — a sold lead leaves the ranking entirely.
 */
const STAGE_SCORES: Record<string, number> = {
  interested: 25,
  potential: 15,
  sales_contacted: 5,
  marketing_contacted: 2,
  no_result: -10,
  unable_to_contact: -15,
  not_sold: -25,
}

function scoreEmail(email: string | null | undefined): number {
  if (!email) return 0
  const domain = email.split("@")[1]?.toLowerCase() || ""
  if (DISPOSABLE_PATTERNS.some((p) => domain.includes(p))) return -15
  // A company address is still a real signal — it just cannot be a requirement.
  if (!FREE_EMAIL_DOMAINS.includes(domain)) return 10
  return 3
}

function scoreTitle(title: string | null | undefined): number {
  if (!title) return 0
  for (const [pattern, points] of TITLE_SCORES) {
    if (pattern.test(title)) return points
  }
  return 0
}

function scoreEstimatedValue(value: number | null | undefined): number {
  if (!value || value <= 0) return 0
  if (value >= 100000) return 15
  if (value >= 50000) return 10
  if (value >= 10000) return 5
  return 2
}

/** 0–100 for the card's bars. Clamped, never a raw point total. */
function pct(value: number, max: number): number {
  if (max <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)))
}

export type LeadScoreInput = {
  id: string
  email?: string | null
  phone?: string | null
  phoneWhatsApp?: string | null
  telegramHandle?: string | null
  contactName?: string | null
  companyName?: string | null
  source?: string | null
  interest?: string | null
  customerStage?: string | null
  salesCallOutcomes?: string[] | null
  estimatedValue?: number | null
  notes?: string | null
  createdAt: Date
}

export type LeadScoreResult = {
  score: number
  factors: {
    contactCompleteness: number
    engagementLevel: number
    dealPotential: number
    sourceQuality: number
    recency: number
  }
}

export async function calculateLeadScore(
  orgId: string,
  lead: LeadScoreInput,
): Promise<LeadScoreResult> {
  let score = 30 // Base

  // 1. Can we reach them at all — and on how many channels?
  //
  // This replaces "has a work email". A phone number is worth more than an
  // email to a business that closes on the telephone, and for a chat lead it is
  // the whole point of the qualification: the conversation exists to get it.
  const channels = [lead.email, lead.phone, lead.phoneWhatsApp, lead.telegramHandle]
    .filter((value) => typeof value === "string" && value.trim().length > 0).length
  const reachability = channels === 0 ? -15 : Math.min(15, channels * 8)
  score += reachability
  score += scoreEmail(lead.email)

  // 2. Title seniority, where a title exists to read.
  score += scoreTitle(`${lead.contactName || ""} ${lead.notes || ""}`)

  // 3. Money on the table.
  const valuePoints = scoreEstimatedValue(lead.estimatedValue)
  score += valuePoints
  if (lead.companyName && lead.companyName.trim().length > 2) score += 5

  // 4. Did they say what they want? A stated need is the difference between a
  //    contact and a lead, and it was not read at all before.
  const interest = (lead.interest || "").trim()
  const interestPoints = interest.length >= 60 ? 10 : interest.length >= 15 ? 6 : 0
  score += interestPoints

  // 5. The salesperson's verdict. Largest single term on purpose.
  const stagePoints = lead.customerStage ? (STAGE_SCORES[lead.customerStage] ?? 0) : 0
  const outcomePoints = (lead.salesCallOutcomes ?? []).reduce(
    (best, outcome) => Math.max(best, STAGE_SCORES[outcome] ?? 0),
    0,
  )
  const verdict = stagePoints !== 0 ? stagePoints : outcomePoints
  score += verdict

  // 6. Source conversion history — kept, but it can no longer punish.
  //
  // A negative here is circular: a channel converts poorly, so its leads rank
  // low, so they are worked last, so it converts poorly. It may reward a proven
  // source; it may not sentence a new one.
  let sourceRate = 0
  if (lead.source) {
    const sourceStats = await prisma.lead.groupBy({
      by: ["status"],
      where: { organizationId: orgId, source: lead.source },
      _count: { id: true },
    })
    const converted = sourceStats.find((s) => s.status === "converted")?._count.id || 0
    const total = sourceStats.reduce((sum, s) => sum + s._count.id, 0)
    if (total >= 5) {
      sourceRate = converted / total
      if (sourceRate >= 0.3) score += 10
      else if (sourceRate >= 0.1) score += 5
    }
  }

  // 7. Engagement.
  const activities = await prisma.activity.findMany({
    where: { organizationId: orgId, relatedType: "lead", relatedId: lead.id },
    select: { createdAt: true },
    orderBy: { createdAt: "desc" },
  })
  const actCount = activities.length
  let engagement = 0
  if (actCount >= 5) engagement = 10
  else if (actCount >= 3) engagement = 5
  else if (actCount >= 1) engagement = 2
  // No deduction for zero: a lead created five minutes ago has no history yet,
  // and docking it for that is docking it for being new.
  score += engagement

  // 8. Recency of the last touch.
  let recencyPoints = 0
  const lastTouch = activities[0]?.createdAt
  if (lastTouch) {
    const daysSince = Math.floor((Date.now() - lastTouch.getTime()) / 86400000)
    if (daysSince <= 3) recencyPoints = 5
    else if (daysSince > 30) recencyPoints = -10
    else if (daysSince > 14) recencyPoints = -5
  }
  score += recencyPoints

  // 9. Age decay for leads nobody has moved.
  const leadAge = Math.floor((Date.now() - lead.createdAt.getTime()) / 86400000)
  if (leadAge > 90) score -= 15
  else if (leadAge > 60) score -= 10
  else if (leadAge > 30) score -= 5

  // 10. Urgency words in the notes.
  if (lead.notes) {
    if (/\b(budget|бюджет|asap|urgent|срочно|təcili|this month|этом месяце)\b/i.test(lead.notes)) score += 10
    if (lead.notes.length > 100) score += 3
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    factors: {
      contactCompleteness: pct(Math.max(0, reachability) + Math.max(0, scoreEmail(lead.email)), 25),
      engagementLevel: pct(engagement + Math.max(0, verdict), 35),
      dealPotential: pct(valuePoints + interestPoints, 25),
      sourceQuality: pct(sourceRate * 100, 30),
      recency: pct(recencyPoints + 10, 15),
    },
  }
}

const SCORE_FIELDS = {
  id: true,
  email: true,
  phone: true,
  phoneWhatsApp: true,
  telegramHandle: true,
  contactName: true,
  companyName: true,
  source: true,
  interest: true,
  customerStage: true,
  salesCallOutcomes: true,
  estimatedValue: true,
  notes: true,
  createdAt: true,
} as const

/**
 * Score one lead, now, because something happened to it.
 *
 * The cron is a sweeper for the parts of the model that move on their own —
 * age, recency. Everything else changes when a person does something, and a
 * number that only refreshes on a timer is wrong for exactly as long as the
 * timer takes: a lead created after the last pass showed "0/100 (F)", which is
 * not "not scored yet", it is the product calling the customer worthless.
 *
 * Never throws: scoring is an opinion about a lead, and no opinion is worth
 * failing the request that created it.
 */
export async function scoreLeadNow(orgId: string, leadId: string): Promise<number | null> {
  try {
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, organizationId: orgId },
      select: SCORE_FIELDS,
    })
    if (!lead) return null
    const result = await calculateLeadScore(orgId, lead)
    await prisma.lead.update({
      where: { id: lead.id },
      data: { score: result.score, scoreDetails: { factors: result.factors }, lastScoredAt: new Date() },
    })
    return result.score
  } catch (e) {
    console.error("[lead-scoring] scoreLeadNow failed", { leadId, error: e instanceof Error ? e.message : String(e) })
    return null
  }
}

/**
 * Recalculate scores for all active leads in an organization.
 * Called by cron.
 */
export async function recalculateOrgLeadScores(orgId: string): Promise<number> {
  const leads = await prisma.lead.findMany({
    where: {
      organizationId: orgId,
      status: { notIn: ["converted", "lost"] },
    },
    select: SCORE_FIELDS,
  })

  let updated = 0
  for (const lead of leads) {
    const result = await calculateLeadScore(orgId, lead)
    await prisma.lead.update({
      where: { id: lead.id },
      // Stamped so that "never scored" and "scored badly" stop looking alike.
      data: { score: result.score, scoreDetails: { factors: result.factors }, lastScoredAt: new Date() },
    })
    updated++
  }

  return updated
}
