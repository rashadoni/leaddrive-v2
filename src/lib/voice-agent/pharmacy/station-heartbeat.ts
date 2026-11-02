import { randomUUID } from "node:crypto"
import { rename, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, join } from "node:path"
import { z } from "zod"

import { readPrivate } from "./zeytun-private-file"

/**
 * The PBX station says once a minute that it is there (owner, 2026-10-29:
 * «исправь из списка что осталось» — the line watch could not see the station
 * behind Fanum's VPN). scripts/pbx/fanum-station-heartbeat.py posts whether the
 * trunk is registered with the operator and the voice program runs; the last
 * report lies next to the line grant, so every process (both line slots, the
 * web fallback) reads the same one. The line health check turns it into one
 * word for the watch.
 */
export const stationHeartbeatSchema = z.strictObject({ trunkRegistered: z.boolean(), voiceActive: z.boolean() })
export type StationReport = z.infer<typeof stationHeartbeatSchema> & { at: string }
/** Reported every minute: three missed minutes is a station that went quiet. */
export const STATION_SILENT_MS = 3 * 60_000
export type StationState = "ok" | "silent" | "trunk_down" | "voice_down" | null

function heartbeatPath(grantFile = process.env.ZEYTUN_INBOUND_PILOT_FILE ?? "") {
  return grantFile && isAbsolute(grantFile) ? join(dirname(grantFile), "station-heartbeat.json") : null
}

export async function recordStationHeartbeat(report: z.infer<typeof stationHeartbeatSchema>, now = new Date(), grantFile?: string) {
  const path = heartbeatPath(grantFile)
  if (!path) throw new Error("station_heartbeat_unconfigured")
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify({ ...report, at: now.toISOString() }), { mode: 0o600, flag: "wx" })
  await rename(temporary, path)
}

/** null when the station never reported here (its timer is not installed yet). */
export async function loadStationReport(grantFile?: string): Promise<StationReport | null> {
  const path = heartbeatPath(grantFile)
  if (!path) return null
  try {
    const raw = await readPrivate(path, 1024) as Record<string, unknown>
    const parsed = stationHeartbeatSchema.safeParse({ trunkRegistered: raw?.trunkRegistered, voiceActive: raw?.voiceActive })
    return parsed.success && typeof raw.at === "string" ? { ...parsed.data, at: raw.at } : null
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}

export function stationState(report: StationReport | null, now: number): StationState {
  if (!report) return null
  const age = now - Date.parse(report.at)
  if (!Number.isFinite(age) || age > STATION_SILENT_MS) return "silent"
  if (!report.trunkRegistered) return "trunk_down"
  if (!report.voiceActive) return "voice_down"
  return "ok"
}
