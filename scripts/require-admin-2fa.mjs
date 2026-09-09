// Operator script: turn on the per-user `require2fa` flag for every account
// holding a privileged role.
//
// Why a script and not a code rule: inferring the requirement from the role was
// deliberately removed in commit 0a8f87477 ("make MFA setup explicitly
// configurable"). This respects that decision — it sets the same flag an
// administrator would set by hand in the Users UI, just without relying on
// anyone remembering. Finding F-05, option A, in
// docs/isms/ISMS-02-gap-analysis.md.
//
// Read-only unless APPLY=1. The dry run is the default on purpose: this changes
// how real people sign in, and the list should be read before it is executed.
//
// No session invalidation is needed. `require2fa` is part of the freshUser
// select in src/lib/auth.ts, so the next JWT refresh picks it up and routes the
// user to /login/setup-2fa on its own.
//
// Env: DATABASE_URL, CONFIRM_PROD=1, APPLY=0|1
import { makeScriptPrisma } from "./_rls.mjs"

const PRIVILEGED_ROLES = ["admin", "superadmin"]

if (process.env.CONFIRM_PROD !== "1") {
  throw new Error("Set CONFIRM_PROD=1 to run against the production database")
}
const APPLY = process.env.APPLY === "1"

/** Enough to recognise your own account, not enough to leak a user list. */
function maskEmail(email) {
  const [local = "", domain = ""] = String(email).split("@")
  const head = local.slice(0, 2)
  return `${head}${"*".repeat(Math.max(local.length - 2, 1))}@${domain}`
}

const prisma = await makeScriptPrisma()

try {
  // lower(trim(...)) because `users.role` is a free-form text column, not an
  // enum: a row that ever reads "Admin" must not escape the sweep.
  const targets = await prisma.$queryRawUnsafe(`
    SELECT id, email, role, "require2fa", "totpEnabled", "smsAuthEnabled",
           "verifiedPhone", "isActive"
    FROM users
    WHERE lower(trim(role)) = ANY($1::text[])
    ORDER BY role, email
  `, PRIVILEGED_ROLES)

  if (targets.length === 0) {
    console.log("No accounts hold a privileged role. Nothing to do.")
    process.exit(0)
  }

  const hasFactor = (u) => u.totpEnabled || (u.smsAuthEnabled && u.verifiedPhone)
  const pending = targets.filter((u) => !u.require2fa)

  console.log(`Privileged accounts found: ${targets.length}`)
  console.log("")
  for (const u of targets) {
    const flag = u.require2fa ? "required" : "NOT REQUIRED"
    const factor = hasFactor(u) ? (u.totpEnabled ? "totp" : "sms") : "none enrolled"
    const active = u.isActive ? "" : " [inactive]"
    console.log(`  ${u.role.padEnd(11)} ${maskEmail(u.email).padEnd(28)} ${flag.padEnd(13)} factor: ${factor}${active}`)
  }
  console.log("")

  if (pending.length === 0) {
    console.log("Every privileged account already requires a second factor. Nothing to change.")
    process.exit(0)
  }

  // The operationally important line: these people will be redirected to
  // /login/setup-2fa on their next sign-in and cannot skip it.
  const willBeForced = pending.filter((u) => !hasFactor(u))
  console.log(`Accounts to update: ${pending.length}`)
  console.log(`Of those, ${willBeForced.length} have no factor enrolled and will be`)
  console.log("required to set up an authenticator app at their next sign-in.")
  console.log("")

  if (!APPLY) {
    console.log("DRY RUN — nothing was written. Re-run with APPLY=1 to apply.")
    process.exit(0)
  }

  const result = await prisma.user.updateMany({
    where: { id: { in: pending.map((u) => u.id) } },
    data: { require2fa: true },
  })
  console.log(`APPLIED — require2fa set on ${result.count} account(s).`)
  console.log("Evidence for the ISMS: this run's log, its date, and the count above.")
} finally {
  await prisma.$disconnect()
}
