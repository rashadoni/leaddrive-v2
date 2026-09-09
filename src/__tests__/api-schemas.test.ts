import { describe, it, expect } from "vitest"
import { z } from "zod"

/**
 * Tests Zod schemas from various Phase 4 API routes to catch validation bugs.
 * Each schema is recreated exactly as in the route file.
 */

// ─── Ticket update schema (from tickets/[id]/route.ts) ───
const updateTicketSchema = z.object({
  subject: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  status: z.enum(["new", "open", "in_progress", "waiting", "resolved", "closed"]).optional(),
  assignedTo: z.string().optional(),
  contactId: z.string().optional(),
  companyId: z.string().optional(),
  category: z.enum(["general", "technical", "billing", "feature_request"]).optional(),
})

// ─── Task update schema (from tasks/[id]/route.ts) ───
const updateTaskSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).optional(),
  status: z.enum(["pending", "todo", "in_progress", "completed", "cancelled"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  dueDate: z.string().nullable().optional(),
  assignedTo: z.string().nullable().optional(),
  relatedType: z.string().nullable().optional(),
  relatedId: z.string().nullable().optional(),
})

// ─── Journey update schema (from journeys/[id]/route.ts) ───
const stepSchema = z.object({
  stepType: z.string(),
  stepOrder: z.number().int(),
  config: z.any().default({}),
  yesNextStepId: z.string().nullable().optional(),
  noNextStepId: z.string().nullable().optional(),
  splitPaths: z.any().nullable().optional(),
})

const updateJourneySchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(["draft", "active", "paused", "completed"]).optional(),
  triggerType: z.string().optional(),
  triggerConditions: z.any().optional(),
  steps: z.array(stepSchema).optional(),
  goalType: z.string().nullable().optional(),
  goalConditions: z.any().nullable().optional(),
  goalTarget: z.number().int().nullable().optional(),
  exitOnGoal: z.boolean().optional(),
  maxEnrollmentDays: z.number().int().nullable().optional(),
})

// ─── AI config schema (from ai-configs/route.ts) ───
const createConfigSchema = z.object({
  configName: z.string().min(1).max(255),
  model: z.string().optional(),
  maxTokens: z.number().optional(),
  temperature: z.number().optional(),
  systemPrompt: z.string().optional(),
  toolsEnabled: z.union([z.string(), z.array(z.string())]).optional(),
  escalationEnabled: z.boolean().optional(),
  escalationRules: z.array(z.string()).optional(),
  kbEnabled: z.boolean().optional(),
  kbMaxArticles: z.number().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().optional(),
  agentType: z.enum(["sales", "support", "marketing", "analyst", "contract", "general"]).optional(),
  department: z.string().max(100).optional(),
  priority: z.number().int().optional(),
  handoffTargets: z.array(z.string()).optional(),
  intents: z.array(z.string()).optional(),
  greeting: z.string().max(1000).optional(),
  maxToolRounds: z.number().int().optional(),
})

// ─── Form submit schema (from public/form-submit/route.ts) ───
const formSubmitSchema = z.object({
  pageId: z.string().min(1, "pageId is required"),
  orgId: z.string().min(1).optional(),
  organizationId: z.string().min(1).optional(),
  name: z.string().max(200).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(50).optional(),
  company: z.string().max(200).optional(),
  formData: z.record(z.string(), z.any()).optional(),
}).passthrough().refine(data => data.orgId || data.organizationId, {
  message: "orgId or organizationId is required",
})

describe("Ticket update schema", () => {
  it("accepts valid partial update", () => {
    expect(updateTicketSchema.safeParse({ status: "resolved" }).success).toBe(true)
    expect(updateTicketSchema.safeParse({ priority: "critical" }).success).toBe(true)
    expect(updateTicketSchema.safeParse({ subject: "New subject" }).success).toBe(true)
  })

  it("rejects invalid status", () => {
    expect(updateTicketSchema.safeParse({ status: "invalid_status" }).success).toBe(false)
  })

  it("rejects invalid priority", () => {
    expect(updateTicketSchema.safeParse({ priority: "super_high" }).success).toBe(false)
  })

  it("accepts empty object (all optional)", () => {
    expect(updateTicketSchema.safeParse({}).success).toBe(true)
  })

  it("rejects subject longer than 300 chars", () => {
    expect(updateTicketSchema.safeParse({ subject: "x".repeat(301) }).success).toBe(false)
  })
})

describe("Task update schema", () => {
  it("accepts valid update", () => {
    expect(updateTaskSchema.safeParse({ status: "completed", title: "Do thing" }).success).toBe(true)
  })

  it("accepts nullable dueDate", () => {
    expect(updateTaskSchema.safeParse({ dueDate: null }).success).toBe(true)
    expect(updateTaskSchema.safeParse({ dueDate: "2026-12-31" }).success).toBe(true)
  })

  it("rejects invalid status", () => {
    expect(updateTaskSchema.safeParse({ status: "done" }).success).toBe(false)
  })

  it("accepts 'todo' status (often missed)", () => {
    expect(updateTaskSchema.safeParse({ status: "todo" }).success).toBe(true)
  })
})

describe("Journey update schema with branching", () => {
  it("accepts steps with branching fields", () => {
    const result = updateJourneySchema.safeParse({
      name: "Onboarding Flow",
      steps: [
        { stepType: "send_email", stepOrder: 0, config: { template: "welcome" } },
        {
          stepType: "condition",
          stepOrder: 1,
          config: { field: "status", value: "qualified" },
          yesNextStepId: "step-a",
          noNextStepId: "step-b",
        },
        {
          stepType: "ab_split",
          stepOrder: 2,
          config: {},
          splitPaths: [
            { nextStepId: "step-c", percentage: 50 },
            { nextStepId: "step-d", percentage: 50 },
          ],
        },
      ],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.steps![1].yesNextStepId).toBe("step-a")
      expect(result.data.steps![1].noNextStepId).toBe("step-b")
      expect(result.data.steps![2].splitPaths).toHaveLength(2)
    }
  })

  it("accepts null branching fields", () => {
    const result = updateJourneySchema.safeParse({
      steps: [
        { stepType: "wait", stepOrder: 0, yesNextStepId: null, noNextStepId: null, splitPaths: null },
      ],
    })
    expect(result.success).toBe(true)
  })

  it("accepts goal tracking fields", () => {
    const result = updateJourneySchema.safeParse({
      goalType: "deal_created",
      goalConditions: { minValue: 1000 },
      goalTarget: 10,
      exitOnGoal: true,
      maxEnrollmentDays: 30,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.goalType).toBe("deal_created")
      expect(result.data.exitOnGoal).toBe(true)
      expect(result.data.maxEnrollmentDays).toBe(30)
    }
  })

  it("accepts null goal fields", () => {
    const result = updateJourneySchema.safeParse({
      goalType: null,
      goalConditions: null,
      goalTarget: null,
      maxEnrollmentDays: null,
    })
    expect(result.success).toBe(true)
  })
})

describe("AI Config schema with orchestration", () => {
  it("accepts all orchestration fields", () => {
    const result = createConfigSchema.safeParse({
      configName: "Sales Bot",
      agentType: "sales",
      department: "Revenue",
      priority: 5,
      handoffTargets: ["agent-2", "agent-3"],
      intents: ["sales_inquiry", "pricing"],
      greeting: "Hi! I can help with pricing.",
      maxToolRounds: 10,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agentType).toBe("sales")
      expect(result.data.priority).toBe(5)
      expect(result.data.intents).toEqual(["sales_inquiry", "pricing"])
    }
  })

  it("rejects invalid agentType", () => {
    const result = createConfigSchema.safeParse({
      configName: "Test",
      agentType: "invalid_type",
    })
    expect(result.success).toBe(false)
  })

  it("accepts toolsEnabled as comma-separated string", () => {
    const result = createConfigSchema.safeParse({
      configName: "Test",
      toolsEnabled: "create_ticket,add_note,log_activity",
    })
    expect(result.success).toBe(true)
  })

  it("accepts toolsEnabled as array", () => {
    const result = createConfigSchema.safeParse({
      configName: "Test",
      toolsEnabled: ["create_ticket", "add_note"],
    })
    expect(result.success).toBe(true)
  })

  it("rejects greeting longer than 1000 chars", () => {
    const result = createConfigSchema.safeParse({
      configName: "Test",
      greeting: "x".repeat(1001),
    })
    expect(result.success).toBe(false)
  })
})

describe("Form submit schema", () => {
  it("accepts orgId variant", () => {
    const result = formSubmitSchema.safeParse({
      pageId: "page-1",
      orgId: "org-1",
      email: "user@test.com",
    })
    expect(result.success).toBe(true)
  })

  it("accepts organizationId variant", () => {
    const result = formSubmitSchema.safeParse({
      pageId: "page-1",
      organizationId: "org-1",
      name: "John Doe",
    })
    expect(result.success).toBe(true)
  })

  it("rejects when neither orgId nor organizationId", () => {
    const result = formSubmitSchema.safeParse({
      pageId: "page-1",
      email: "user@test.com",
    })
    expect(result.success).toBe(false)
  })

  it("rejects missing pageId", () => {
    const result = formSubmitSchema.safeParse({
      orgId: "org-1",
    })
    expect(result.success).toBe(false)
  })

  it("accepts nested formData object", () => {
    const result = formSubmitSchema.safeParse({
      pageId: "page-1",
      orgId: "org-1",
      formData: {
        fullName: "Test User",
        email: "test@example.com",
        company: "ACME",
        customField: "value",
      },
    })
    expect(result.success).toBe(true)
  })

  it("rejects invalid email format", () => {
    const result = formSubmitSchema.safeParse({
      pageId: "page-1",
      orgId: "org-1",
      email: "not-email",
    })
    expect(result.success).toBe(false)
  })
})
