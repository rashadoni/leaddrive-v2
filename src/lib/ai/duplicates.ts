import { prisma } from "@/lib/prisma"

export function normalize(s: string | null | undefined): string {
  return (s || "").toLowerCase().trim().replace(/\s+/g, " ")
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const dp: number[] = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) dp[j] = j
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1])
      prev = tmp
    }
  }
  return dp[b.length]
}

export function similarityRatio(a: string, b: string): number {
  const an = normalize(a), bn = normalize(b)
  if (!an || !bn) return 0
  const maxLen = Math.max(an.length, bn.length)
  if (maxLen === 0) return 0
  return 1 - levenshtein(an, bn) / maxLen
}

export function phoneDigits(phone: string | null | undefined): string {
  return (phone || "").replace(/\D/g, "")
}

export interface DuplicateCandidate {
  primaryId: string
  duplicateId: string
  primaryLabel: string
  duplicateLabel: string
  reason: string
  similarityScore: number
}

export async function findDuplicateContacts(orgId: string, now: Date): Promise<DuplicateCandidate[]> {
  // Look at contacts created in the last 24h — check each against all contacts
  const recent = new Date(now.getTime() - 24 * 3600000)
  const newcomers = await prisma.contact.findMany({
    where: { organizationId: orgId, createdAt: { gte: recent } },
    select: { id: true, fullName: true, email: true, phone: true, createdAt: true },
    take: 50,
  })
  if (newcomers.length === 0) return []

  const all = await prisma.contact.findMany({
    where: { organizationId: orgId, isActive: true },
    select: { id: true, fullName: true, email: true, phone: true, createdAt: true },
  })

  const candidates: DuplicateCandidate[] = []

  for (const newc of newcomers) {
    const newEmail = normalize(newc.email)
    const newPhone = phoneDigits(newc.phone)

    for (const other of all) {
      if (other.id === newc.id) continue
      if (other.createdAt > newc.createdAt) continue // other must be older (primary = oldest)

      const otherEmail = normalize(other.email)
      const otherPhone = phoneDigits(other.phone)

      let matched = false
      let reason = ""
      let score = 0

      if (newEmail && newEmail === otherEmail) {
        matched = true
        reason = "Same email address"
        score = 1.0
      } else if (newPhone && newPhone.length >= 7 && newPhone === otherPhone) {
        matched = true
        reason = "Same phone number"
        score = 0.95
      } else {
        const nameSim = similarityRatio(newc.fullName, other.fullName)
        if (nameSim >= 0.9 && (newEmail || newPhone) && ((newEmail && otherEmail && newEmail !== otherEmail) === false)) {
          matched = true
          reason = `Name similarity ${Math.round(nameSim * 100)}% with matching contact info`
          score = nameSim * 0.9
        }
      }

      if (matched) {
        candidates.push({
          primaryId: other.id,
          duplicateId: newc.id,
          primaryLabel: `${other.fullName}${other.email ? ` <${other.email}>` : ""}`,
          duplicateLabel: `${newc.fullName}${newc.email ? ` <${newc.email}>` : ""}`,
          reason,
          similarityScore: score,
        })
        break
      }
    }
  }

  return candidates
}

export async function writeDuplicateContactShadowAction(
  orgId: string,
  candidate: DuplicateCandidate,
  now: Date,
  shadow: boolean,
) {
  await prisma.aiShadowAction.create({
    data: {
      organizationId: orgId,
      featureName: shadow ? "ai_auto_duplicate_shadow" : "ai_auto_duplicate",
      entityType: "contact",
      entityId: candidate.duplicateId,
      actionType: "merge_contact",
      payload: {
        primaryId: candidate.primaryId,
        duplicateId: candidate.duplicateId,
        primaryLabel: candidate.primaryLabel,
        duplicateLabel: candidate.duplicateLabel,
        reason: candidate.reason,
        similarityScore: candidate.similarityScore,
      },
      approved: shadow ? null : true,
      reviewedAt: shadow ? null : now,
      reviewedBy: shadow ? null : "system",
    },
  })
}

export async function filterNewDuplicateCandidates(
  orgId: string,
  candidates: DuplicateCandidate[],
  now: Date,
): Promise<DuplicateCandidate[]> {
  if (candidates.length === 0) return []
  const duplicateIds = candidates.map(c => c.duplicateId)
  const existing = await prisma.aiShadowAction.findMany({
    where: {
      organizationId: orgId,
      featureName: { in: ["ai_auto_duplicate", "ai_auto_duplicate_shadow"] },
      entityType: "contact",
      entityId: { in: duplicateIds },
      OR: [{ approved: null }, { reviewedAt: { gte: new Date(now.getTime() - 30 * 86400000) } }],
    },
    select: { entityId: true },
  })
  const skip = new Set(existing.map((e: { entityId: string }) => e.entityId))
  return candidates.filter(c => !skip.has(c.duplicateId))
}
