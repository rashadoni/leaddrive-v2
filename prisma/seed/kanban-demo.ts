/**
 * Demo seed for the Jira-style Kanban board (/boards/[divisionId]).
 * Creates a "KHS" division + tasks across all 6 columns with the same counts
 * as the design screenshot (9/2/5/3/7/20). Idempotent-ish: skips if KHS already
 * has tasks. Local-only run:
 * `ADMIN_PASSWORD='...' npx tsx prisma/seed/kanban-demo.ts`.
 */
import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"
import { passwordPolicyError } from "../../scripts/password-policy.mjs"

function isLocalDatabase(databaseUrl: string | undefined): boolean {
  if (process.env.NODE_ENV === "production") return false
  try {
    const hostname = new URL(databaseUrl || "").hostname
    return ["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"].includes(hostname)
  } catch {
    return false
  }
}

if (!isLocalDatabase(process.env.DATABASE_URL)) {
  throw new Error("kanban-demo is restricted to a non-production local database")
}

const prisma = new PrismaClient()

const NAMES = ["acme.az", "Eden Agro", "ibk.az", "ztp.az", "Pentest of Azertexnolayn.com", "shamkiragropark.az", "bakucaviar.az", "agec.az"]
const COLS: [string, number][] = [["backlog", 9], ["todo", 2], ["in_progress", 5], ["testing", 3], ["review", 7], ["done", 20]]
const TYPES = ["bug", "feature", "story", "epic", "task"]
const PRIOS = ["low", "medium", "high", "critical"]

async function main() {
  let org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } })
  if (!org) {
    // Empty dev DB → bootstrap a demo org + an admin you can log in as.
    const adminPassword = process.env.ADMIN_PASSWORD
    const passwordError = passwordPolicyError(adminPassword)
    if (passwordError) throw new Error(`ADMIN_PASSWORD rejected: ${passwordError}`)
    const passwordHash = await bcrypt.hash(adminPassword as string, 12)
    const passwordChangedAt = new Date()
    org = await prisma.organization.create({ data: { name: "Demo Org", slug: "demo" } })
    await prisma.user.create({
      data: {
        organizationId: org.id,
        email: "demo@leaddrive.local",
        name: "Demo Admin",
        passwordHash,
        passwordChangedAt,
        role: "admin",
      },
    })
    console.log('Bootstrapped empty DB → org "demo" + admin demo@leaddrive.local (password read from ADMIN_PASSWORD)')
  }
  const users = await prisma.user.findMany({ where: { organizationId: org.id }, take: 6, select: { id: true } })
  const head = users[0]?.id ?? null

  const division = await prisma.division.upsert({
    where: { organizationId_key: { organizationId: org.id, key: "KHS" } },
    create: { organizationId: org.id, key: "KHS", name: "Pentest Board", color: "#0052CC", headUserId: head },
    update: {},
  })

  const already = await prisma.task.count({ where: { divisionId: division.id } })
  if (already > 0) {
    console.log(`KHS already has ${already} tasks — skipping. Open: /boards/${division.id}`)
    return
  }

  let n = 1
  for (const [status, count] of COLS) {
    for (let i = 0; i < count; i++) {
      const assignee = users.length ? users[n % users.length].id : null
      await prisma.task.create({
        data: {
          organizationId: org.id,
          divisionId: division.id,
          taskKey: `KHS-${n}`,
          title: `${NAMES[n % NAMES.length]}`,
          status,
          type: TYPES[n % TYPES.length],
          priority: PRIOS[n % PRIOS.length],
          category: n % 9 === 0 ? "Q1" : null,
          assignedTo: assignee,
          createdBy: head,
          dueDate: new Date(Date.now() + (n % 30) * 86_400_000),
          ...(status === "done" ? { completedAt: new Date(Date.now() - (i % 14) * 86_400_000) } : {}),
        },
      })
      n++
    }
  }
  console.log(`Seeded division KHS (${division.id}) + ${n - 1} tasks in org "${org.slug}".`)
  console.log(`Open the board at: /boards/${division.id}`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
