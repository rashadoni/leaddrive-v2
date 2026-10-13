import { describe, expect, it, vi } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PrismaClient } from "@prisma/client"
import { PHONE, assertPhoneOwner, phoneFailure, preparePhone, readPhone, validatePhoneEvidence } from "../../scripts/mtm-attendance-phone-fixture"

const owned = { id: PHONE.id, slug: PHONE.slug, settings: { attendancePhoneOwner: PHONE.marker } }
describe("separate physical phone fixture", () => {
  it("requires exact tenant ID, slug and ownership marker", () => {
    expect(() => assertPhoneOwner(owned)).not.toThrow()
    for (const row of [null, { ...owned, id: "other" }, { ...owned, slug: "real-customer" }, { ...owned, settings: {} }]) {
      expect(() => assertPhoneOwner(row)).toThrow("PHONE_NOT_OWNED")
    }
  })
  it("refuses both identity collisions before writes and does not rewrite an owned repeat", async () => {
    const create = vi.fn()
    const tx = { $executeRaw: vi.fn(), organization: { findMany: vi.fn(), create } }
    const db = { $transaction: (fn: (value: typeof tx) => unknown) => fn(tx) } as unknown as PrismaClient
    for (const rows of [[{ ...owned, settings: {} }], [owned, owned]]) {
      tx.organization.findMany.mockResolvedValue(rows)
      await expect(preparePhone(db, "must-not-be-written")).rejects.toThrow("PHONE_NOT_OWNED")
    }
    tx.organization.findMany.mockResolvedValue([owned])
    await expect(preparePhone(db, "must-not-replace-existing-password")).resolves.toBe(false)
    expect(create).not.toHaveBeenCalled()
  })
  it("sets the check transaction read-only before any lookup", async () => {
    const calls: string[] = []
    const tx = { $executeRawUnsafe: async (sql: string) => { calls.push(sql) }, $executeRaw: async () => { calls.push("scope") },
      organization: { findMany: async () => { calls.push("owner"); return [] } } }
    const db = { $transaction: (fn: (value: typeof tx) => unknown) => fn(tx) } as unknown as PrismaClient
    await expect(readPhone(db)).rejects.toThrow("PHONE_NOT_OWNED")
    expect(calls).toEqual(["SET TRANSACTION READ ONLY", "scope", "owner"])
  })
  it("refuses any credential, user payload or unrecognised error in public evidence", () => {
    const pass = { version: 1, status: "PASS", artifactSha: "a".repeat(40), tenant: PHONE.slug, created: true, users: 3, agents: 3 }
    expect(validatePhoneEvidence(pass)).toEqual(pass)
    for (const extra of [{ password: "PRIVATE" }, { users: [{ email: "PRIVATE" }] }, { agents: 4 }, { tenant: "real" }]) {
      expect(() => validatePhoneEvidence({ ...pass, ...extra })).toThrow()
    }
    expect(phoneFailure(new Error("database secret PRIVATE"))).toEqual({ version: 1, status: "FAIL", code: "PHONE_FAILED" })
    expect(() => validatePhoneEvidence({ version: 1, status: "FAIL", code: "PRIVATE" })).toThrow()
  })
  it("bundles a standalone controller and validates output without loading production resources", () => {
    const file = join(mkdtempSync(join(tmpdir(), "mtm-phone-bundle-")), "controller.cjs")
    const build = spawnSync(process.execPath, ["scripts/build-mtm-attendance-phone-controller.mjs", file], { encoding: "utf8" })
    expect(build.status).toBe(0)
    expect(readFileSync(file, "utf8")).not.toContain('require("./mtm-attendance-demo-verification")')
    const run = spawnSync(process.execPath, [file, "--validate-phone-output"], { input: JSON.stringify(phoneFailure(null)), encoding: "utf8" })
    expect(run.status).toBe(0)
    expect(JSON.parse(run.stdout)).toEqual(phoneFailure(null))
  })
})
