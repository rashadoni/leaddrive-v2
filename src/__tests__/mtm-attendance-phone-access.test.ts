import { beforeAll, describe, expect, it } from "vitest"
import { constants, generateKeyPairSync, privateDecrypt, randomBytes, type KeyObject } from "node:crypto"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PHONE } from "../../scripts/mtm-attendance-phone-fixture"
import { phoneAccessFailure, phoneAccessRecipient, sealPhoneAccess, validatePhoneAccess } from "../../scripts/mtm-attendance-phone-access"

let pair: { publicKey: KeyObject; privateKey: KeyObject }, recipient: string, fingerprint: string
const sha = "a".repeat(40)
const saved = { marker: PHONE.marker, password: randomBytes(48).toString("base64url") }
beforeAll(() => {
  pair = generateKeyPairSync("rsa", { modulusLength: 4096 })
  recipient = pair.publicKey.export({ format: "der", type: "spki" }).toString("base64")
  fingerprint = phoneAccessRecipient(recipient).fingerprint
}, 20000)

describe("encrypted access to the owned physical-phone fixture", () => {
  it("delivers the credential only to the chosen recipient with tenant and revision binding", () => {
    const envelope = sealPhoneAccess(saved, recipient, sha)
    expect(validatePhoneAccess(envelope, fingerprint)).toEqual(envelope)
    expect(JSON.stringify(envelope)).not.toContain(saved.password)
    expect(envelope).not.toHaveProperty("password")
    const plaintext = privateDecrypt({ key: pair.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256", oaepLabel: Buffer.from(PHONE.marker) }, Buffer.from(envelope.ciphertext, "base64"))
    expect(JSON.parse(plaintext.toString())).toEqual({ ...saved, artifactSha: sha })
    expect(sealPhoneAccess(saved, recipient, sha).ciphertext).not.toBe(envelope.ciphertext)
    expect(() => privateDecrypt({ key: pair.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256", oaepLabel: Buffer.from("other-tenant") }, Buffer.from(envelope.ciphertext, "base64"))).toThrow()
  })
  it("rejects weaker, malformed, private and non-RSA recipient keys", () => {
    const weak = generateKeyPairSync("rsa", { modulusLength: 2048 })
    const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    for (const encoded of ["bad", recipient + "\n", "x".repeat(2048),
      weak.publicKey.export({ format: "der", type: "spki" }).toString("base64"),
      ec.publicKey.export({ format: "der", type: "spki" }).toString("base64"),
      pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64")]) {
      expect(() => phoneAccessRecipient(encoded)).toThrow()
    }
    const envelope = sealPhoneAccess(saved, recipient, sha)
    expect(() => privateDecrypt({ key: weak.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256", oaepLabel: Buffer.from(PHONE.marker) }, Buffer.from(envelope.ciphertext, "base64"))).toThrow()
  })
  it("does not package an unowned credential or extra fields", () => {
    for (const value of [null, {}, { ...saved, marker: "another-company" }, { ...saved, password: "short" }, { ...saved, token: "private" }]) {
      expect(() => sealPhoneAccess(value, recipient, sha)).toThrow()
    }
    expect(() => sealPhoneAccess(saved, recipient, "main")).toThrow()
  })
  it("rejects plaintext, unknown payloads, malformed encryption and another recipient in evidence", () => {
    const pass = sealPhoneAccess(saved, recipient, sha)
    for (const extra of [{ password: saved.password }, { tenant: "real-company" }, { algorithm: "none" },
      { ciphertext: saved.password }, { recipientSha256: "b".repeat(64) }, { artifactSha: "main" }]) {
      expect(() => validatePhoneAccess({ ...pass, ...extra }, fingerprint)).toThrow()
    }
    expect(validatePhoneAccess(phoneAccessFailure(), fingerprint)).toEqual({ version: 1, status: "FAIL", code: "PHONE_ACCESS_FAILED" })
    expect(() => validatePhoneAccess({ version: 1, status: "FAIL", code: "private database error" }, fingerprint)).toThrow()
  })
  it("bundles and validates an envelope without loading production resources", () => {
    const file = join(mkdtempSync(join(tmpdir(), "mtm-phone-access-test-")), "controller.cjs")
    const build = spawnSync(process.execPath, ["scripts/build-mtm-attendance-phone-access.mjs", file], { encoding: "utf8" })
    expect(build.status).toBe(0)
    expect(readFileSync(file, "utf8")).not.toContain('require("./mtm-attendance-phone-fixture")')
    const pass = sealPhoneAccess(saved, recipient, sha)
    const run = spawnSync(process.execPath, [file, "--validate-phone-access", fingerprint], { input: JSON.stringify(pass), encoding: "utf8" })
    expect(run.status).toBe(0)
    expect(JSON.parse(run.stdout)).toEqual(pass)
    const rejected = spawnSync(process.execPath, [file, "--validate-phone-access", fingerprint], { input: JSON.stringify({ ...pass, password: saved.password }), encoding: "utf8" })
    expect(rejected.status).not.toBe(0)
    expect(rejected.stdout + rejected.stderr).not.toContain(saved.password)
    const preparation = spawnSync(process.execPath, [file, "--prepare-phone", sha], { encoding: "utf8" })
    expect(preparation.status).not.toBe(0)
    expect(preparation.stderr).toContain("Unsupported phone access mode")
    expect(preparation.stdout).toBe("")
  })
})
