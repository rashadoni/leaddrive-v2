/**
 * Create or upgrade a user to superadmin role.
 * Usage: SUPERADMIN_PASSWORD='...' SUPERADMIN_ORG_SLUG=system \
 *   npx tsx scripts/create-superadmin.ts <email>
 *
 * The operation is scoped to one explicit organization. Creating or upgrading
 * always rotates the credential and invalidates pre-existing sessions.
 */
import type { PrismaClient } from "@prisma/client"
import { makeScriptPrisma } from "./_rls.mjs"
import bcrypt from "bcryptjs"
import { passwordPolicyError } from "./password-policy.mjs"

let prisma!: PrismaClient

async function main() {
  prisma = await makeScriptPrisma()
  const email = process.argv[2]?.trim().toLowerCase()
  const organizationSlug = (process.env.SUPERADMIN_ORG_SLUG || "system").trim()

  if (!email) {
    console.error("Usage: SUPERADMIN_PASSWORD='...' SUPERADMIN_ORG_SLUG=system npx tsx scripts/create-superadmin.ts <email>")
    console.error("Example: npx tsx scripts/create-superadmin.ts rashad@leaddrivecrm.org")
    process.exit(1)
  }

  let org = await prisma.organization.findUnique({ where: { slug: organizationSlug } })
  const existing = org
    ? await prisma.user.findUnique({
        where: { organizationId_email: { organizationId: org.id, email } },
      })
    : null

  if (existing) {
    if (existing.role === "superadmin") {
      console.log(`✓ User ${email} is already a superadmin in ${organizationSlug}`)
      return
    }
  }

  // Require a policy-compliant credential for both create and upgrade. A role
  // change with the legacy hash left intact would bypass the current policy.
  const password = process.env.SUPERADMIN_PASSWORD
  if (!password) {
    throw new Error("Set SUPERADMIN_PASSWORD to create or upgrade a superadmin")
  }
  const passwordError = passwordPolicyError(password)
  if (passwordError) throw new Error(`SUPERADMIN_PASSWORD rejected: ${passwordError}`)
  const passwordHash = await bcrypt.hash(password, 12)
  const passwordChangedAt = new Date()

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { role: "superadmin", passwordHash, passwordChangedAt },
    })

    console.log(`✓ Upgraded ${email} to superadmin in ${organizationSlug} (was: ${existing.role})`)
    console.log("  Password rotated from SUPERADMIN_PASSWORD; prior sessions invalidated.")
    return
  }

  console.log(`User ${email} not found in ${organizationSlug}. Creating new superadmin...`)

  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: "System Administration",
        slug: organizationSlug,
        plan: "enterprise",
        maxUsers: -1,
        maxContacts: -1,
      },
    })
    console.log(`  Created system organization`)
  }

  await prisma.user.create({
    data: {
      email,
      name: "Super Admin",
      role: "superadmin",
      organizationId: org.id,
      passwordHash,
      passwordChangedAt,
    },
  })

  console.log(`✓ Created superadmin user:`)
  console.log(`  Email: ${email}`)
  console.log(`  Organization: ${org.name}`)
  console.log("  Password was read from SUPERADMIN_PASSWORD and was not logged.")
}

main()
  .catch((e) => {
    console.error("Error:", e.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
