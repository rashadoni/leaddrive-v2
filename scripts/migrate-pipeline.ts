import type { PrismaClient } from "@prisma/client"
import { makeScriptPrisma } from "./_rls.mjs"

let prisma!: PrismaClient

const DEFAULT_STAGES = [
  { name: "LEAD", displayName: "Lead", color: "#6366f1", probability: 10, sortOrder: 1, isWon: false, isLost: false },
  { name: "QUALIFIED", displayName: "Qualified", color: "#3b82f6", probability: 25, sortOrder: 2, isWon: false, isLost: false },
  { name: "PROPOSAL", displayName: "Proposal", color: "#f59e0b", probability: 50, sortOrder: 3, isWon: false, isLost: false },
  { name: "NEGOTIATION", displayName: "Negotiation", color: "#f97316", probability: 75, sortOrder: 4, isWon: false, isLost: false },
  { name: "WON", displayName: "Won", color: "#22c55e", probability: 100, sortOrder: 5, isWon: true, isLost: false },
  { name: "LOST", displayName: "Lost", color: "#ef4444", probability: 0, sortOrder: 6, isWon: false, isLost: true },
]

async function main() {
  prisma = await makeScriptPrisma()
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } })
  console.log(`Found ${orgs.length} organizations`)

  for (const org of orgs) {
    // Check if pipeline already exists for this org
    const existing = await prisma.pipeline.findFirst({
      where: { organizationId: org.id },
    })
    if (existing) {
      console.log(`  [${org.name}] Pipeline already exists: ${existing.name} — skipping`)
      continue
    }

    // Create default pipeline
    const pipeline = await prisma.pipeline.create({
      data: {
        organizationId: org.id,
        name: "Default Sales",
        isDefault: true,
        isActive: true,
        sortOrder: 0,
      },
    })
    console.log(`  [${org.name}] Created pipeline: ${pipeline.name} (${pipeline.id})`)

    // Check if org already has pipeline stages
    const existingStages = await prisma.pipelineStage.findMany({
      where: { organizationId: org.id },
    })

    if (existingStages.length > 0) {
      // Link existing stages to the new pipeline
      await prisma.pipelineStage.updateMany({
        where: { organizationId: org.id, pipelineId: null },
        data: { pipelineId: pipeline.id },
      })
      console.log(`  [${org.name}] Linked ${existingStages.length} existing stages to pipeline`)
    } else {
      // Create default stages
      for (const stage of DEFAULT_STAGES) {
        await prisma.pipelineStage.create({
          data: {
            organizationId: org.id,
            pipelineId: pipeline.id,
            ...stage,
          },
        })
      }
      console.log(`  [${org.name}] Created ${DEFAULT_STAGES.length} default stages`)
    }

    // Link all deals to this pipeline
    const updated = await prisma.deal.updateMany({
      where: { organizationId: org.id, pipelineId: null },
      data: { pipelineId: pipeline.id },
    })
    console.log(`  [${org.name}] Linked ${updated.count} deals to pipeline`)
  }

  console.log("\nDone!")
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
