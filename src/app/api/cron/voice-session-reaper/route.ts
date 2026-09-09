import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { requireCronAuth } from "@/lib/cron-auth"
import { settleVoiceSeconds } from "@/lib/ai/voice/budget"
import { HEARTBEAT_GRACE_SECONDS } from "@/lib/ai/voice/config"
import { voiceMarkerIsPreConnection } from "@/lib/ai/voice/session-marker"

/**
 * Close voice sessions whose console stopped beating.
 *
 * This is the counterpart to reserve-then-settle. We cannot end a conversation
 * on the provider's side, so a tab that was closed mid-call — or a phone that
 * went into a pocket — leaves a row that would otherwise stay "active" forever
 * and hold its reservation. Such a session is settled at its FULL reservation,
 * not at zero: under-billing an abandoned call is what would make the budget
 * trivially evadable.
 *
 * Runs across all tenants, hence the bypass scope. Every write still carries an
 * explicit organizationId taken from the row itself.
 */
const BATCH_SIZE = 200

export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
    const cronError = requireCronAuth(req)
    if (cronError) return cronError

    const cutoff = new Date(Date.now() - HEARTBEAT_GRACE_SECONDS * 1000)

    const stale = await prisma.voiceSession.findMany({
      where: { status: "active", lastHeartbeatAt: { lt: cutoff } },
      select: {
        id: true,
        organizationId: true,
        userId: true,
        reservedSeconds: true,
        startedAt: true,
        elevenlabsConversationId: true,
        lastHeartbeatAt: true,
      },
      take: BATCH_SIZE,
      orderBy: { lastHeartbeatAt: "asc" },
    })

    let reaped = 0
    let neverConnected = 0
    for (const s of stale) {
      /**
       * Did this session ever become a conversation?
       *
       * Charging the full reservation is right for a session someone WALKED
       * AWAY from — otherwise closing the tab would be free and the budget
       * would mean nothing. It is wrong for one that never connected at all.
       *
       * Production showed the difference: five sessions minted inside
       * twenty-three seconds, none with a single tool call or heartbeat beyond
       * creation, twenty-five minutes billed. The user was clicking a button
       * that was failing to load, and every click cost five minutes of a
       * hundred-and-twenty-minute month.
       *
       * The connect route writes a durable marker before its only provider
       * request. Unlike tool calls and browser heartbeats, that marker cannot
       * mistake a loaded console for a provider conversation. Null therefore
       * means no provider request was made; any non-null marker is either a
       * confirmed connection or an ambiguous in-flight request and is billed
       * conservatively.
       */
      const connectionMarker = s.elevenlabsConversationId
      const everConnected = !voiceMarkerIsPreConnection(connectionMarker)
      const billed = everConnected ? s.reservedSeconds : 0
      // Guarded per row: a user hitting "stop" at the same moment must win, and
      // the loser must not settle a second time.
      const closed = await prisma.voiceSession.updateMany({
        where: {
          id: s.id,
          organizationId: s.organizationId,
          status: "active",
          // A connect that claims or finalizes after this SELECT must win this
          // race. The reaper only closes the exact state it classified.
          elevenlabsConversationId: connectionMarker,
        },
        data: {
          // Причина живёт в статусе — колонки endReason у модели нет, и
          // запись в несуществующее поле роняла создание сессии целиком.
          status: everConnected ? "abandoned" : "never_connected",
          endedAt: new Date(),
          billedSeconds: billed,
        },
      })
      if (closed.count !== 1) continue

      await settleVoiceSeconds(
        s.organizationId,
        s.userId,
        s.reservedSeconds,
        billed,
        s.startedAt,
      )
      reaped += 1
      if (!everConnected) neverConnected += 1
    }

    // neverConnected is reported so a spike is visible: a burst of them means
    // the console is failing to start for someone, which is a defect, not usage.
    return NextResponse.json({ data: { scanned: stale.length, reaped, neverConnected } })
  })
}
