// Dedicated operator path for a reviewed provider outcome. No web process receives this credential.
// node scripts/booking/reconcile-effect.mjs --evidence=/private/receipt.json [--apply]
import { readFile } from "node:fs/promises"
import { PrismaClient } from "@prisma/client"
const evidencePath = process.argv.find((value) => value.startsWith("--evidence="))?.slice(11)
if (!evidencePath || !process.env.BOOKING_EFFECT_OPERATOR_DATABASE_URL) throw new Error("Operator database URL and --evidence are required")
const input = JSON.parse(await readFile(evidencePath, "utf8"))
if (!input.organizationId || !/^[a-f0-9-]{36}$/.test(input.effectId) || !["retry", "succeeded", "dead"].includes(input.decision) || typeof input.reason !== "string" || input.reason.length < 10 || !input.evidence || typeof input.evidence !== "object") throw new Error("Evidence must identify organization/effect/decision, a reason and provider readback")
const db = new PrismaClient({ datasources: { db: { url: process.env.BOOKING_EFFECT_OPERATOR_DATABASE_URL } } })
try {
  const [identity] = await db.$queryRaw`SELECT current_user AS role`
  if (identity.role !== "leaddrive_effect_operator") throw new Error("This command requires the dedicated leaddrive_effect_operator identity")
  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.org_id', ${input.organizationId}, true)`
    await tx.$queryRaw`SELECT id FROM effect_outbox WHERE id = ${input.effectId}::uuid AND "organizationId" = ${input.organizationId} FOR UPDATE`
    const effect = await tx.effectOutbox.findFirst({ where: { id: input.effectId, organizationId: input.organizationId } })
    if (!effect || !effect.effectType.startsWith("booking.") || effect.status !== "reconciliation_required") throw new Error("An unresolved booking effect was not found")
    if (!process.argv.includes("--apply")) return { dryRun: true, effectId: effect.id, status: effect.status, decision: input.decision }
    await tx.effectReconciliation.create({ data: { organizationId: input.organizationId, effectId: effect.id, attemptNumber: effect.attemptCount, decision: input.decision, reason: input.reason, providerReference: input.providerReference ?? null, evidence: input.evidence } })
    const status = input.decision === "retry" ? "pending" : input.decision
    await tx.effectOutbox.update({ where: { id: effect.id }, data: { status, ...(status === "pending" ? { providerRequestId: null, providerResult: null, completedAt: null, reconciliationAt: null, lastError: null, availableAt: new Date() } : { completedAt: new Date() }) } })
    return { effectId: effect.id, status }
  })
  process.stdout.write(`${JSON.stringify(result)}\n`)
} finally { await db.$disconnect() }
