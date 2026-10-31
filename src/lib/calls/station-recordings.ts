import { mkdir, readdir, rename, stat, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

import { openTenantFileStream, sealTenantFile } from "@/lib/crypto/tenant-file-encryption"
import { ensureTenantDataKeys } from "@/lib/crypto/tenant-data-keys"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { runtimePrivateUploadDirectory } from "@/lib/runtime-paths"

/**
 * Recordings of the Zeytun line's calls, made by the PBX station
 * (owner, 2026-10-31: «нужно чтоб и диалог записывался»; no announcement in
 * the greeting, the owner's decision the same day). Asterisk records what the
 * pharmacy heard and said — the AI, the wait filler, a manager after a
 * transfer — and the station posts the file once the call is over.
 *
 * The file is a customer's file: sealed with the organization's key on disk,
 * read back only through the decoder, kept RETENTION_DAYS and then deleted.
 * CallLog.recordingUrl holds a marker, never a path or a URL: the playback
 * route sees the marker and streams the file itself instead of redirecting.
 */
export const STATION_RECORDING_MARKER = "station-recording:v1"
export const RETENTION_DAYS = 90
/**
 * Next's proxy hands a route only the first 10 MB of a body. The station sends
 * 8 kHz G.711 mu-law — what the phone line itself carries — at 8 KB/s, so this
 * is about 20 minutes; a line call ends at 15.
 */
export const MAX_RECORDING_BYTES = 9_728_000
const ID = /^[A-Za-z0-9_-]{1,64}$/u

export function isStationRecording(recordingUrl: string | null | undefined): boolean {
  return recordingUrl === STATION_RECORDING_MARKER
}

function recordingsRoot() {
  return runtimePrivateUploadDirectory("call-recordings")
}

function recordingPath(orgId: string, callLogId: string) {
  if (!ID.test(orgId) || !ID.test(callLogId)) throw new Error("invalid_recording_id")
  return path.join(recordingsRoot(), orgId, `${callLogId}.wav`)
}

/** A WAVE file of phone audio: linear PCM or G.711 mu-law, which every browser plays. Nothing else. */
export function isPhoneWave(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 44 || bytes.byteLength > MAX_RECORDING_BYTES) return false
  const text = (start: number) => Buffer.from(bytes.subarray(start, start + 4)).toString("latin1")
  const format = bytes[20] | (bytes[21] << 8)
  return text(0) === "RIFF" && text(8) === "WAVE" && text(12) === "fmt " && (format === 1 || format === 7)
}

/** Seal and keep the call's recording; the call row then says it has one. */
export async function storeStationRecording(orgId: string, callLogId: string, wave: Uint8Array): Promise<void> {
  const target = recordingPath(orgId, callLogId)
  await ensureTenantDataKeys(orgId)
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, sealTenantFile(orgId, wave), { mode: 0o600 })
  await rename(temporary, target)
  await runWithTenant(orgId, () => prisma.callLog.updateMany({
    where: { id: callLogId, organizationId: orgId }, data: { recordingUrl: STATION_RECORDING_MARKER } }))
}

/** The call's recording as plain WAVE bytes for an already authorized reader; null when it is gone. */
export async function openStationRecording(orgId: string, callLogId: string) {
  const file = recordingPath(orgId, callLogId)
  const info = await stat(file).catch(() => null)
  if (!info?.isFile()) return null
  return openTenantFileStream(orgId, file, info.size)
}

/**
 * Delete recordings older than RETENTION_DAYS and clear their calls' marker.
 * Age is the file's own time on disk (written when the call ended).
 */
export async function purgeExpiredStationRecordings(now = Date.now()): Promise<{ deleted: number }> {
  const cutoff = now - RETENTION_DAYS * 24 * 60 * 60 * 1000
  let deleted = 0
  const organizations = await readdir(recordingsRoot()).catch(() => [] as string[])
  for (const orgId of organizations) {
    if (!ID.test(orgId)) continue
    const names = await readdir(path.join(recordingsRoot(), orgId)).catch(() => [] as string[])
    const expired: string[] = []
    for (const name of names) {
      const callLogId = name.endsWith(".wav") ? name.slice(0, -4) : null
      if (!callLogId || !ID.test(callLogId)) continue
      const info = await stat(path.join(recordingsRoot(), orgId, name)).catch(() => null)
      if (info && info.mtimeMs < cutoff) expired.push(callLogId)
    }
    for (const callLogId of expired) {
      await unlink(recordingPath(orgId, callLogId)).catch(() => undefined)
      deleted++
    }
    if (expired.length) {
      await runWithRlsBypass(() => prisma.callLog.updateMany({
        where: { organizationId: orgId, id: { in: expired }, recordingUrl: STATION_RECORDING_MARKER },
        data: { recordingUrl: null } }))
    }
  }
  return { deleted }
}
