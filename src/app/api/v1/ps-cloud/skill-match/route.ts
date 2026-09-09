/**
 * POST /api/v1/ps-cloud/skill-match
 *
 * Rank active users in the org by how well they cover a requested set of
 * skills. Powers the slice-2 "Staff a project" UI.
 *
 * Body: `{ requiredSkills: string[], excludeUnavailable?: boolean, limit?: number }`
 *
 * Response: `{ candidates: SkillMatchResult[], hiringGap: string[] }`
 *   - `candidates`: ranked match list, score 0-1
 *   - `hiringGap`: required skills that NO user in the org has
 *
 * Part of R12 Professional Services Cloud (Phase 2 slice 1).
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { matchUsersToSkills, findHiringGap } from "@/lib/ps-cloud/skill-match"

const bodySchema = z.object({
  requiredSkills: z.array(z.string().min(1).max(64)).min(1).max(30),
  excludeUnavailable: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional(),
})

export const POST = withRlsAuth("settings", "read", async (req, auth) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  // Active-only at DB level — saves payload for orgs with many former users.
  // `findHiringGap` still needs to see ALL active candidates (already
  // filtered) to determine what no current user covers; including inactive
  // historic users in that scan would mask real gaps the firm should hire for.
  const users = await prisma.user.findMany({
    where: { organizationId: auth.orgId, isActive: true },
    select: {
      id: true, name: true, skills: true, isActive: true, isAvailable: true,
    },
  })

  const candidates = matchUsersToSkills(users, parsed.data.requiredSkills, {
    excludeInactive: true,
    excludeUnavailable: parsed.data.excludeUnavailable ?? false,
    limit: parsed.data.limit ?? 50,
  })

  const hiringGap = findHiringGap(users, parsed.data.requiredSkills)

  return NextResponse.json({ candidates, hiringGap })
})
