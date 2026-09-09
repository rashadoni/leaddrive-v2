// Prints ONLY the brandprotection organization id (used server-side by the
// routing-on step to scope the Bright Data live-routing tenant allowlist).
// Output is captured into a shell var on the server and never echoed to CI logs.
import { makeScriptPrisma } from "../_rls.mjs"
const prisma = await makeScriptPrisma()
try {
  const org = await prisma.organization.findFirst({ where: { slug: "brandprotection" }, select: { id: true } })
  if (!org) { process.exit(1) }
  process.stdout.write(org.id)
} finally {
  await prisma.$disconnect()
}
