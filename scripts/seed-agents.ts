import type { PrismaClient } from "@prisma/client"
import { makeScriptPrisma } from "./_rls.mjs"

let prisma!: PrismaClient

async function main() {
  prisma = await makeScriptPrisma()
  // Find all organizations
  const orgs = await prisma.organization.findMany({ select: { id: true } })

  for (const org of orgs) {
    // Check which agent types already exist
    const existingAgents = await prisma.aiAgentConfig.findMany({
      where: { organizationId: org.id },
      select: { agentType: true },
    })
    const existingTypes = new Set(existingAgents.map((a: any) => a.agentType))

    const allAgents = [
      {
        organizationId: org.id,
        configName: "Sales Agent",
        agentType: "sales",
        model: "claude-sonnet-4-6",
        systemPrompt: "You are a sales specialist. Help with deals, pricing, proposals, and customer acquisition.",
        toolsEnabled: ["create_deal", "update_deal_stage", "log_activity", "add_note", "send_email", "create_task"],
        isActive: true,
        priority: 10,
        intents: ["sales_inquiry"],
        maxToolRounds: 5,
      },
      {
        organizationId: org.id,
        configName: "Support Agent",
        agentType: "support",
        model: "claude-haiku-4-5-20251001",
        systemPrompt: "You are a support specialist. Help resolve customer issues, manage tickets, and ensure satisfaction.",
        toolsEnabled: ["create_ticket", "add_note", "log_activity", "create_task"],
        isActive: true,
        priority: 10,
        intents: ["support_request", "billing_question"],
        maxToolRounds: 5,
      },
      {
        organizationId: org.id,
        configName: "Marketing Agent",
        agentType: "marketing",
        model: "claude-haiku-4-5-20251001",
        systemPrompt: "You are a marketing specialist. Help with campaigns, analytics, and lead generation strategies.",
        toolsEnabled: ["log_activity", "add_note", "create_task"],
        isActive: true,
        priority: 5,
        intents: ["marketing_info"],
        maxToolRounds: 3,
      },
      {
        organizationId: org.id,
        configName: "Da Vinci",
        agentType: "general",
        model: "claude-sonnet-4-6",
        systemPrompt: "You are Da Vinci, a general-purpose CRM assistant. Help with any CRM-related questions and tasks.",
        toolsEnabled: ["add_note", "log_activity", "create_task"],
        isActive: true,
        priority: 0,
        intents: ["general", "data_analysis"],
        maxToolRounds: 5,
      },
    ]

    const agentsToCreate = allAgents.filter(a => !existingTypes.has(a.agentType))
    if (agentsToCreate.length === 0) {
      console.log(`Org ${org.id} already has all 4 agent types, skipping`)
      continue
    }

    for (const agent of agentsToCreate) {
      await prisma.aiAgentConfig.create({ data: agent })
    }
    console.log(`Created ${agentsToCreate.length} missing agents for org ${org.id} (had ${existingTypes.size}/4)`)
  }
}

main()
  .then(() => { console.log("Done"); process.exit(0) })
  .catch(e => { console.error(e); process.exit(1) })
