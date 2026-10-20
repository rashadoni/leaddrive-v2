import { prisma } from "@/lib/prisma"

/**
 * «Tətbiq: Şəbəkədədir» for somebody on a break.
 *
 * The demo clip «Marşrut & Sahə» shows the agent on a break with his app
 * connected, and the owner ordered production to behave like the clip
 * (2026-10-20). The live map calls the app connected while
 * `MtmAgent.lastSeenAt` is younger than the organization's «fresh» limit
 * (presentMtmDashboardAgent). Until now only an accepted GPS point wrote it —
 * and no point is accepted during a break (workday-pauses.ts) — so five
 * minutes into lunch every agent read «Şəbəkədə deyil», his app open or not.
 *
 * What the field app (leaddrive-mtm, MTMobileApp) sends while the workday is
 * paused: its tracking service stops with the pause, and nothing runs in the
 * background — no heartbeat (the 60-second POST /mobile/ping lives in App.tsx,
 * which is not the Android entry), no background fetch, and a backgrounded
 * app's JS timers stand still. While one of its main screens is open, the
 * bell asks GET /mobile/notifications every two minutes. That request now
 * says the app is there — on a break only, and never a coordinate: it sets
 * `lastSeenAt` and `isOnline`, the two fields an accepted GPS point sets.
 * `isOnline` too (verification of 2026-10-20): FINISH clears it, and a day
 * a manager reopens comes back paused — the app open on that break would
 * otherwise read «не на связи» until his first fix after it.
 *
 * Every two minutes is slower than an organization's «fresh» limit may be
 * (down to 30 s), so the live map holds the app present on a break for at
 * least MTM_BREAK_APP_PRESENCE_SECONDS (mtm-types.ts).
 *
 * A working agent's presence stays a GPS fact (POST /mobile/ping), and
 * nobody without a paused workday is made present by a tablet left on a
 * desk. Returns whether the moment was recorded.
 */
export async function recordMtmAppPresenceDuringBreak(input: {
  organizationId: string
  agentId: string
  now?: Date
}): Promise<boolean> {
  const recorded = await prisma.mtmAgent.updateMany({
    where: {
      id: input.agentId,
      organizationId: input.organizationId,
      status: "ACTIVE",
      workdays: { some: { organizationId: input.organizationId, status: "PAUSED" } },
    },
    data: { isOnline: true, lastSeenAt: input.now ?? new Date() },
  })
  return recorded.count > 0
}
