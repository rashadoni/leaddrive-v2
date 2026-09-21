import {
  JOURNEY_ACTIVITY_EVENT,
  JOURNEY_ACTIVITY_EVERY_MS,
  type DemoJourneyReport,
} from "@/lib/demo-center/journey"

export interface JourneyReporter {
  /** A move of the story or a clip played: sent once per session, a reload included. */
  report(report: DemoJourneyReport): void
  /** «Still here»: sent at most once a minute, whatever else was sent. */
  activity(sectionId: string, stepId?: string): void
}

/**
 * A granted session's link to the server (src/lib/demo-center/journey/telemetry.ts).
 * Fire-and-forget: a lost report never blocks the story. Every answer carries
 * the session's new idle deadline, which is how the countdown on screen
 * stays in step with the server's.
 */
export function createJourneyReporter(
  token: string,
  handlers: { onIdleExpiresAt: (iso: string) => void; onAccessLost?: () => void },
): JourneyReporter {
  const storageKey = `ld_demo_journey_sent_${token.slice(-16)}`
  const sent = new Set<string>(readSent(storageKey))
  let lastContact = 0

  function send(body: DemoJourneyReport) {
    lastContact = Date.now()
    void fetch(`/api/v1/public/demo-access/${encodeURIComponent(token)}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      keepalive: true,
    })
      .then(async (response) => {
        if ([401, 403, 409, 410].includes(response.status)) {
          handlers.onAccessLost?.()
          return
        }
        const payload = (await response.json().catch(() => null)) as { idleExpiresAt?: string } | null
        if (response.ok && payload?.idleExpiresAt) handlers.onIdleExpiresAt(payload.idleExpiresAt)
      })
      .catch(() => {})
  }

  return {
    report(report) {
      const id = [report.name, report.sectionId, report.stepId ?? report.to ?? ""].join("|")
      if (sent.has(id)) return
      sent.add(id)
      try {
        window.sessionStorage.setItem(storageKey, JSON.stringify([...sent]))
      } catch {
        /* private mode: a reload may report a move twice, the server caps it */
      }
      send(report)
    },
    activity(sectionId, stepId) {
      if (Date.now() - lastContact < JOURNEY_ACTIVITY_EVERY_MS) return
      send({ eventType: "JOURNEY", name: JOURNEY_ACTIVITY_EVENT, sectionId, ...(stepId ? { stepId } : {}) })
    },
  }
}

function readSent(key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(key) ?? "[]")
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}
