import { prisma } from "@/lib/prisma"

interface LeadData {
  id: string
  source?: string | null
  estimatedValue?: number | null
  companyName?: string | null
  notes?: string | null
  [key: string]: unknown
}

interface Condition {
  field: string
  operator: string
  value: string
}

function matchCondition(lead: LeadData, cond: Condition): boolean {
  const fieldVal = String(lead[cond.field] ?? "").toLowerCase()
  const condVal = cond.value.toLowerCase()

  switch (cond.operator) {
    case "==": return fieldVal === condVal
    case "!=": return fieldVal !== condVal
    case ">=": return Number(lead[cond.field] ?? 0) >= Number(cond.value)
    case "<=": return Number(lead[cond.field] ?? 0) <= Number(cond.value)
    case "contains": return fieldVal.includes(condVal)
    case "starts_with": return fieldVal.startsWith(condVal)
    default: return false
  }
}

/** Apply lead assignment rules and update assignedTo. Fire-and-forget. */
export async function applyLeadAssignmentRules(orgId: string, lead: LeadData) {
  try {
    const rules = await prisma.leadAssignmentRule.findMany({
      where: { organizationId: orgId, isActive: true },
      orderBy: { priority: "asc" },
    })

    if (rules.length === 0) return

    for (const rule of rules) {
      const conditions = (rule.conditions as Condition[]) || []
      const assignees = (rule.assignees as string[]) || []

      if (assignees.length === 0) continue

      if (rule.method === "round_robin" && conditions.length === 0) {
        // Round-robin fallback — pick assignee based on lead count modulo
        const count = await prisma.lead.count({ where: { organizationId: orgId } })
        const assignee = assignees[count % assignees.length]
        await prisma.lead.update({
          where: { id: lead.id },
          data: { assignedTo: assignee },
        })
        return
      }

      // Condition-based: all conditions must match
      const allMatch = conditions.every(c => matchCondition(lead, c))
      if (allMatch) {
        // If multiple assignees on a condition rule, round-robin among them
        let assignee: string
        if (assignees.length === 1) {
          assignee = assignees[0]
        } else {
          const count = await prisma.lead.count({ where: { organizationId: orgId } })
          assignee = assignees[count % assignees.length]
        }
        await prisma.lead.update({
          where: { id: lead.id },
          data: { assignedTo: assignee },
        })
        return // First matching rule wins
      }
    }
  } catch (e) {
    console.error("[lead-assignment]", e)
  }
}
