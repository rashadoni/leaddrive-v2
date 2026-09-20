// Create or rotate the dedicated Meta App Review administrator in the
// existing leaddrive sandbox tenant. The password is generated on the
// production server and written only to a root-owned credential file.
//
// Required: DATABASE_URL, CONFIRM_PROD=meta-review:leaddrive
import crypto from "node:crypto"
import {
  chmodSync,
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
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

const TENANT_SLUG = "leaddrive"
const REVIEWER_EMAIL = "meta-review@leaddrivecrm.org"
const CREDENTIAL_DIR = "/root/leaddrive-credentials"
const CREDENTIAL_PATH = path.join(CREDENTIAL_DIR, "leaddrive-meta-review.pass")

if (process.env.CONFIRM_PROD !== "meta-review:leaddrive") {
  throw new Error("Set CONFIRM_PROD=meta-review:leaddrive")
}

function stageCredential(password) {
  mkdirSync(CREDENTIAL_DIR, { recursive: true, mode: 0o700 })
  const directory = lstatSync(CREDENTIAL_DIR)
  if (!directory.isDirectory() || directory.isSymbolicLink()) {
    throw new Error(CREDENTIAL_DIR + " must be a real directory")
  }
  chmodSync(CREDENTIAL_DIR, 0o700)

  const temporaryPath = CREDENTIAL_PATH + "." + crypto.randomBytes(8).toString("hex") + ".tmp"
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW
  let descriptor = null
  try {
    descriptor = openSync(temporaryPath, flags, 0o600)
    writeFileSync(descriptor, password + "\n", { encoding: "utf8" })
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = null
    chmodSync(temporaryPath, 0o600)
    return temporaryPath
  } catch (error) {
    if (descriptor !== null) {
      try { closeSync(descriptor) } catch { /* best effort */ }
    }
    throw error
  }
}

function publishCredential(temporaryPath) {
  renameSync(temporaryPath, CREDENTIAL_PATH)
  chmodSync(CREDENTIAL_PATH, 0o600)
}

const prisma = await makeScriptPrisma()
try {
  const organization = await prisma.organization.findUnique({
    where: { slug: TENANT_SLUG },
    select: { id: true },
  })
  if (!organization) throw new Error('Sandbox tenant "' + TENANT_SLUG + '" not found')

  const password = generateStrongTemporaryPassword(crypto.randomBytes)
  const policyError = passwordPolicyError(password)
  if (policyError) throw new Error("Generated password rejected: " + policyError)
  const passwordHash = await bcrypt.hash(password, 12)

  const stagedCredential = stageCredential(password)
  try {
    await prisma.user.upsert({
      where: {
        organizationId_email: {
          organizationId: organization.id,
          email: REVIEWER_EMAIL,
        },
      },
      update: {
        name: "Meta App Reviewer",
        passwordHash,
        role: "admin",
        isActive: true,
        require2fa: false,
        totpEnabled: false,
        smsAuthEnabled: false,
        totpSecret: null,
        verifiedPhone: null,
        backupCodes: [],
        passwordChangedAt: new Date(),
      },
      create: {
        organizationId: organization.id,
        email: REVIEWER_EMAIL,
        name: "Meta App Reviewer",
        passwordHash,
        role: "admin",
        isActive: true,
        require2fa: false,
        totpEnabled: false,
        smsAuthEnabled: false,
        passwordChangedAt: new Date(),
      },
    })
    publishCredential(stagedCredential)
  } catch (error) {
    try { unlinkSync(stagedCredential) } catch { /* best effort */ }
    throw error
  }

  console.log("Reviewer ready; credential stored at " + CREDENTIAL_PATH)
} finally {
  await prisma.$disconnect()
}
