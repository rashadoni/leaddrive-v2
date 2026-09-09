// @ts-nocheck
import type { PrismaClient } from "@prisma/client"
import { makeScriptPrisma } from "./_rls.mjs"
import bcrypt from "bcryptjs"
import { passwordPolicyError } from "../src/lib/password-policy"

let prisma!: PrismaClient

async function main() {
  prisma = await makeScriptPrisma()
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
  if (!ADMIN_PASSWORD) {
    console.error("❌ Set ADMIN_PASSWORD env var")
    process.exit(1)
  }
  const passwordError = passwordPolicyError(ADMIN_PASSWORD)
  if (passwordError) throw new Error(`ADMIN_PASSWORD rejected: ${passwordError}`)

  // Find the organization
  const org = await prisma.organization.findFirst({ where: { slug: "leaddrive" } })
  if (!org) {
    console.log("❌ Organization not found!")
    return
  }
  console.log(`Organization: ${org.name} (${org.id})`)

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12)

  // Create or update admin user
  const admin = await prisma.user.upsert({
    where: { organizationId_email: { organizationId: org.id, email: "rashadrahimsoy@gmail.com" } },
    update: { passwordHash, passwordChangedAt: new Date(), role: "admin", isActive: true },
    create: {
      organizationId: org.id,
      email: "rashadrahimsoy@gmail.com",
      name: "Rashad Rahimov",
      passwordHash,
      role: "admin",
    },
  })
  console.log(`✅ Admin: ${admin.email} (${admin.id})`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
