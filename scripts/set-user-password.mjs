// Operator script: rotate an existing tenant user's password to a random,
// policy-compliant temporary credential generated on the production server.
// The credential is written once to a root-only file and never crosses CI.
//
// Env: DATABASE_URL, CONFIRM_PROD=1, SET_SLUG, SET_EMAIL
import crypto from "node:crypto"
import {
  chmodSync,
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import bcrypt from "bcryptjs"
import { makeScriptPrisma } from "./_rls.mjs"
import {
  generateStrongTemporaryPassword,
  passwordPolicyError,
} from "./password-policy.mjs"

const CREDENTIAL_DIR = "/root/leaddrive-credentials"
const BCRYPT_COST = 12
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/
const EMAIL_PATTERN = /^[a-z0-9._+-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

const slug = process.env.SET_SLUG?.trim()
const email = process.env.SET_EMAIL?.trim().toLowerCase()

function matchesEntirely(pattern, value) {
  return pattern.exec(value)?.[0] === value
}

if (process.env.CONFIRM_PROD !== "1") {
  throw new Error("Set CONFIRM_PROD=1 to run against the production database")
}
if (!slug || !matchesEntirely(SLUG_PATTERN, slug)) {
  throw new Error("SET_SLUG has an unexpected shape")
}
if (!email || !matchesEntirely(EMAIL_PATTERN, email)) {
  throw new Error("SET_EMAIL has an unexpected shape")
}

function writeOneTimeCredential(password) {
  mkdirSync(CREDENTIAL_DIR, { recursive: true, mode: 0o700 })
  const directory = lstatSync(CREDENTIAL_DIR)
  if (!directory.isDirectory() || directory.isSymbolicLink()) {
    throw new Error(`${CREDENTIAL_DIR} must be a real directory`)
  }
  chmodSync(CREDENTIAL_DIR, 0o700)

  const filename = `${slug}-${Date.now()}-${crypto.randomBytes(8).toString("hex")}.pass`
  const credentialPath = path.join(CREDENTIAL_DIR, filename)
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW
  let descriptor = null
  try {
    descriptor = openSync(credentialPath, flags, 0o600)
    writeFileSync(descriptor, `${password}\n`, { encoding: "utf8" })
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = null
    chmodSync(credentialPath, 0o600)
    return credentialPath
  } catch (error) {
    if (descriptor !== null) {
      try { closeSync(descriptor) } catch { /* best-effort cleanup */ }
    }
    try { unlinkSync(credentialPath) } catch { /* best-effort cleanup */ }
    throw error
  }
}

const prisma = await makeScriptPrisma()
let credentialPath = null
try {
  const org = await prisma.organization.findUnique({
    where: { slug },
    select: { id: true },
  })
  if (!org) throw new Error(`Tenant "${slug}" not found`)

  const user = await prisma.user.findUnique({
    where: { organizationId_email: { organizationId: org.id, email } },
    select: { id: true },
  })
  if (!user) throw new Error(`No user ${email} in tenant "${slug}"`)

  const password = generateStrongTemporaryPassword(crypto.randomBytes)
  const policyError = passwordPolicyError(password)
  if (policyError) throw new Error(`Generated password rejected: ${policyError}`)
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST)

  credentialPath = writeOneTimeCredential(password)
  try {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        isActive: true,
      },
    })
  } catch (error) {
    unlinkSync(credentialPath)
    credentialPath = null
    throw error
  }

  console.log(credentialPath)
} finally {
  await prisma.$disconnect()
}
