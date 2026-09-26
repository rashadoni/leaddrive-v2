/**
 * Session clock helpers shared by the demo players.
 *
 * Extracted from `demo-player.tsx` so the guided journey renderer counts the
 * same absolute/idle deadlines the same way. Pure: no React, no network.
 */

export type DemoDeadlineKind = "session" | "idle"

export function secondsUntil(value?: string, offsetMs = 0): number | null {
  if (!value) return null
  const deadline = Date.parse(value)
  if (!Number.isFinite(deadline)) return null
  return Math.max(0, Math.ceil((deadline - (Date.now() + offsetMs)) / 1_000))
}

export function clockOffset(serverNow?: string): number {
  if (!serverNow) return 0
  const parsed = Date.parse(serverNow)
  return Number.isFinite(parsed) ? parsed - Date.now() : 0
}

export function nearestDeadline(
  sessionExpiresAt?: string,
  idleExpiresAt?: string,
): { value: string; kind: DemoDeadlineKind } | null {
  const candidates = [
    sessionExpiresAt ? { value: sessionExpiresAt, kind: "session" as const, time: Date.parse(sessionExpiresAt) } : null,
    idleExpiresAt ? { value: idleExpiresAt, kind: "idle" as const, time: Date.parse(idleExpiresAt) } : null,
  ].filter((candidate): candidate is NonNullable<typeof candidate> => !!candidate && Number.isFinite(candidate.time))

  const nearest = candidates.sort((left, right) => left.time - right.time)[0]
  return nearest ? { value: nearest.value, kind: nearest.kind } : null
}

export function deadlineAnnouncement(
  remainingSeconds: number | null,
  kind: DemoDeadlineKind | null,
): string {
  if (remainingSeconds === null || ![60, 30, 10, 0].includes(remainingSeconds)) return ""
  if (remainingSeconds === 0) return "Demo sessiyasının vaxtı bitdi."
  return `${kind === "idle" ? "Fəaliyyətsizlik limitinə" : "Sessiyanın bitməsinə"} ${formatRemaining(remainingSeconds)} qalıb.`
}

export function formatRemaining(seconds: number): string {
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  const rest = seconds % 60
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
  return `${minutes}:${String(rest).padStart(2, "0")}`
}
