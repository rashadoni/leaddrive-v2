/**
 * The line's call recordings on disk (owner, 2026-10-31: «нужно чтоб и диалог
 * записывался»): sealed with the organization's key, read back only for it,
 * and gone after 90 days together with the call's marker.
 */
import { mkdtemp, readFile, readdir, rm, utimes } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ root: "", updates: [] as unknown[] }))
vi.mock("@/lib/runtime-paths", () => ({ runtimePrivateUploadDirectory: (name: string) => `${state.root}/${name}` }))
vi.mock("@/lib/crypto/tenant-data-keys", () => ({ ensureTenantDataKeys: vi.fn(async () => undefined) }))
vi.mock("@/lib/prisma", () => ({ prisma: { callLog: { updateMany: vi.fn(async (args: unknown) => { state.updates.push(args); return { count: 1 } }) } } }))
vi.mock("@/lib/rls-context", () => ({ runWithTenant: (_org: string, fn: () => unknown) => fn(), runWithRlsBypass: (fn: () => unknown) => fn() }))

import { resetMasterKekCache } from "@/lib/crypto/tenant-pii-encryption"
import { isTenantFileEnvelope } from "@/lib/crypto/tenant-file-encryption"
import {
  openStationRecording, purgeExpiredStationRecordings, RETENTION_DAYS, STATION_RECORDING_MARKER, storeStationRecording,
} from "@/lib/calls/station-recordings"

const TEST_KEK = "0123456789abcdef".repeat(4) // gitleaks:allow — synthetic test key
const ORG = "cmorgaaaaaaaaaaaaaaaaaaaa"
const OTHER_ORG = "cmorgbbbbbbbbbbbbbbbbbbbb"
const WAVE = Buffer.concat([Buffer.from("RIFF0000WAVEfmt "), Buffer.alloc(28), Buffer.from("voice of the call")])

async function plain(stream: NodeJS.ReadableStream) {
  const parts: Buffer[] = []
  for await (const part of stream) parts.push(Buffer.from(part as Buffer))
  return Buffer.concat(parts)
}

beforeAll(async () => { state.root = await mkdtemp(path.join(tmpdir(), "station-recordings-")) })
afterAll(async () => { await rm(state.root, { recursive: true, force: true }) })
beforeEach(() => { process.env.TENANT_PII_MASTER_KEY = TEST_KEK; resetMasterKekCache(); state.updates = [] })
afterEach(() => { delete process.env.TENANT_PII_MASTER_KEY; resetMasterKekCache() })

describe("station call recordings", () => {
  it("are sealed on disk, marked on the call, and read back only for their organization", async () => {
    await storeStationRecording(ORG, "call1", WAVE)
    const stored = await readFile(path.join(state.root, "call-recordings", ORG, "call1.wav"))
    expect(isTenantFileEnvelope(stored)).toBe(true)
    expect(stored.includes(Buffer.from("voice of the call"))).toBe(false)
    expect(state.updates).toEqual([{ where: { id: "call1", organizationId: ORG }, data: { recordingUrl: STATION_RECORDING_MARKER } }])
    const opened = await openStationRecording(ORG, "call1")
    expect(await plain(opened!.stream)).toEqual(WAVE)
    expect(opened!.size).toBe(WAVE.byteLength)
    // Another organization finds nothing under its own name, and a sealed file read for it fails.
    expect(await openStationRecording(OTHER_ORG, "call1")).toBeNull()
    await expect(storeStationRecording(ORG, "../escape", WAVE)).rejects.toThrow("invalid_recording_id")
  })

  it(`are deleted after ${RETENTION_DAYS} days with their calls' marker, newer ones stay`, async () => {
    await storeStationRecording(ORG, "old", WAVE)
    await storeStationRecording(ORG, "new", WAVE)
    const old = new Date(Date.now() - (RETENTION_DAYS + 1) * 24 * 3600_000)
    await utimes(path.join(state.root, "call-recordings", ORG, "old.wav"), old, old)
    state.updates = []
    expect(await purgeExpiredStationRecordings()).toEqual({ deleted: 1 })
    expect((await readdir(path.join(state.root, "call-recordings", ORG))).sort()).toEqual(["call1.wav", "new.wav"])
    expect(state.updates).toEqual([{ where: { organizationId: ORG, id: { in: ["old"] }, recordingUrl: STATION_RECORDING_MARKER },
      data: { recordingUrl: null } }])
  })
})
