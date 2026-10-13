/** Read-only access delivery for the one marker-owned physical-phone fixture.
 * Only a recipient-encrypted envelope leaves production. No reset, login,
 * arbitrary path, user selector or plaintext output is supported. */
import fs from "node:fs"
import { constants, createHash, createPublicKey, publicEncrypt } from "node:crypto"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import type { PrismaClient } from "@prisma/client"
import { PHONE, readPhone } from "./mtm-attendance-phone-fixture"
import { APP, databaseUrlFromEnv, readRootFile } from "./mtm-attendance-demo-verification"

const ALGORITHM = "RSA-OAEP-SHA256"
function fail(code = "PHONE_ACCESS_FAILED"): never { throw new Error(code) }
export function phoneAccessRecipient(encoded: string) {
  if (typeof encoded !== "string" || encoded.length > 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) fail("PHONE_ACCESS_RECIPIENT_INVALID")
  const der = Buffer.from(encoded, "base64")
  if (der.toString("base64") !== encoded) fail("PHONE_ACCESS_RECIPIENT_INVALID")
  const key = createPublicKey({ key: der, format: "der", type: "spki" })
  if (key.asymmetricKeyType !== "rsa" || key.asymmetricKeyDetails?.modulusLength !== 4096) fail("PHONE_ACCESS_RECIPIENT_INVALID")
  return { key, fingerprint: createHash("sha256").update(der).digest("hex") }
}
export function sealPhoneAccess(saved: unknown, recipient: string, sha: string) {
  const value = saved as Record<string, unknown>
  if (!value || typeof value !== "object" || Object.keys(value).sort().join() !== "marker,password"
    || value.marker !== PHONE.marker || typeof value.password !== "string" || !/^[A-Za-z0-9_-]{64}$/.test(value.password)
    || !/^[a-f0-9]{40}$/.test(sha)) fail()
  const { key, fingerprint } = phoneAccessRecipient(recipient)
  const plaintext = Buffer.from(JSON.stringify({ marker: PHONE.marker, password: value.password, artifactSha: sha }))
  try {
    const ciphertext = publicEncrypt({ key, padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256", oaepLabel: Buffer.from(PHONE.marker) }, plaintext).toString("base64")
    return { version: 1, status: "PASS", tenant: PHONE.slug, artifactSha: sha,
      algorithm: ALGORITHM, recipientSha256: fingerprint, ciphertext }
  } finally { plaintext.fill(0) }
}
export function phoneAccessFailure() { return { version: 1, status: "FAIL", code: "PHONE_ACCESS_FAILED" } }
export function validatePhoneAccess(value: unknown, fingerprint: string) {
  const row = value as Record<string, unknown>
  if (!row || typeof row !== "object") fail()
  if (row.status === "FAIL") {
    if (Object.keys(row).sort().join() !== "code,status,version" || row.version !== 1 || row.code !== "PHONE_ACCESS_FAILED") fail()
    return row
  }
  if (Object.keys(row).sort().join() !== "algorithm,artifactSha,ciphertext,recipientSha256,status,tenant,version"
    || row.version !== 1 || row.status !== "PASS" || row.tenant !== PHONE.slug || row.algorithm !== ALGORITHM
    || !/^[a-f0-9]{40}$/.test(String(row.artifactSha)) || !/^[a-f0-9]{64}$/.test(fingerprint)
    || row.recipientSha256 !== fingerprint || typeof row.ciphertext !== "string"
    || !/^[A-Za-z0-9+/]{683}=$/.test(row.ciphertext)
    || Buffer.from(row.ciphertext, "base64").toString("base64") !== row.ciphertext) fail()
  return row
}
export async function runPhoneAccess(sha: string, recipient: string) {
  phoneAccessRecipient(recipient)
  if (process.getuid?.() !== 0 || !/^[a-f0-9]{40}$/.test(sha)
    || readRootFile(`${APP}/.deploy-sha`, 128).trim() !== sha) fail()
  const response = await fetch(`${PHONE.origin}/api/v1/public/build-info`, { redirect: "error", signal: AbortSignal.timeout(10000) })
  if (!response.ok || (await response.json()).artifactSha !== sha) fail()
  process.env.DATABASE_URL = databaseUrlFromEnv(readRootFile("/etc/leaddrive/app.env", 65536))
  const bcrypt = createRequire(`${APP}/package.json`)("bcryptjs") as typeof import("bcryptjs")
  const { makeScriptPrisma } = await import(pathToFileURL(`${APP}/scripts/_rls.mjs`).href)
  const db: PrismaClient = await makeScriptPrisma({ orgId: PHONE.id })
  try {
    // The existing reader sets READ ONLY before its first database lookup and
    // verifies exact ownership, users, roles, activity and privacy settings.
    const snapshot = await readPhone(db)
    const directory = fs.lstatSync(PHONE.state)
    if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== 0 || (directory.mode & 0o777) !== 0o700) fail()
    const saved = JSON.parse(readRootFile(`${PHONE.state}/credential.json`, 1024, true))
    if (saved.marker !== PHONE.marker || typeof saved.password !== "string" || !/^[A-Za-z0-9_-]{64}$/.test(saved.password)) fail()
    for (const user of snapshot.users) if (!await bcrypt.compare(saved.password, user.passwordHash)) fail()
    if (readRootFile(`${APP}/.deploy-sha`, 128).trim() !== sha) fail()
    return sealPhoneAccess(saved, recipient, sha)
  } finally { await db.$disconnect(); delete process.env.DATABASE_URL }
}
if (process.argv[2] === "--phone-access") {
  void runPhoneAccess(process.argv[3], process.argv[4])
    .then(value => process.stdout.write(JSON.stringify(value) + "\n"))
    .catch(() => { process.stdout.write(JSON.stringify(phoneAccessFailure()) + "\n"); process.exitCode = 1 })
} else if (process.argv[2] === "--phone-access-recipient") {
  try { process.stdout.write(phoneAccessRecipient(process.argv[3]).fingerprint + "\n") }
  catch { process.stderr.write("Invalid phone fixture recipient\n"); process.exitCode = 1 }
} else if (process.argv[2] === "--validate-phone-access") {
  try { process.stdout.write(JSON.stringify(validatePhoneAccess(JSON.parse(fs.readFileSync(0, "utf8")), process.argv[3])) + "\n") }
  catch { process.stderr.write("Invalid encrypted fixture evidence; raw output withheld\n"); process.exitCode = 1 }
}
