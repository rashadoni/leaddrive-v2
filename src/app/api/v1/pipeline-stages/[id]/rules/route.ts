import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import {
  coercedNonNegativeFinancialAmountSchema,
  MAX_CRM_FINANCIAL_AMOUNT,
} from "@/lib/validation/numeric"

const RULES_WITH_VALUE = new Set([
  "min_value",
  "max_value",
  "min_length",
  "max_days",
  "min_tasks",
  "min_activities",
])

const compatibleRules: Record<string, readonly string[]> = {
  valueAmount: ["required", "min_value", "max_value"],
  contactId: ["required"],
  notes: ["required", "min_length"],
  expectedClose: ["required", "future_date", "max_days"],
  assignedTo: ["required"],
  companyId: ["required"],
  tasks: ["task_completed", "min_tasks"],
  activities: ["has_activity", "min_activities"],
}

const ruleSchema = z.object({
  fieldName: z.enum([
    "valueAmount",
    "contactId",
    "notes",
    "expectedClose",
    "assignedTo",
    "companyId",
    "tasks",
    "activities",
  ]),
  ruleType: z.enum([
    "required",
    "min_value",
    "max_value",
    "min_length",
    "future_date",
    "max_days",
    "task_completed",
    "min_tasks",
    "has_activity",
    "min_activities",
  ]),
  ruleValue: z.union([z.string().max(64), z.number().finite()]).nullable().optional(),
  errorMessage: z.string().trim().min(1).max(500),
}).superRefine((value, ctx) => {
  if (!compatibleRules[value.fieldName].includes(value.ruleType)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ruleType"],
      message: "Rule type is not valid for this field",
    })
  }

  if (!RULES_WITH_VALUE.has(value.ruleType)) return

  const numericSchema = value.ruleType === "min_value" || value.ruleType === "max_value"
    ? coercedNonNegativeFinancialAmountSchema
    : z.preprocess(
        (raw) => typeof raw === "string" && raw.trim() ? Number(raw.trim()) : raw,
        z.number().finite().int().nonnegative().max(100_000),
      )

  if (!numericSchema.safeParse(value.ruleValue).success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ruleValue"],
      message: `Rule value must be a non-negative number no greater than ${value.ruleType.endsWith("value") ? MAX_CRM_FINANCIAL_AMOUNT : 100_000}`,
    })
  }
})

const deleteRuleSchema = z.object({
  ruleId: z.string().trim().min(1).max(191),
})

type RouteContext = { params: Promise<{ id: string }> }

// GET — list validation rules for a stage
export const GET = withRlsAuth("settings", "read", async (_req, { orgId }, { params }: RouteContext) => {
  const { id } = await params

  const stage = await prisma.pipelineStage.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  })
  if (!stage) {
    return NextResponse.json({ success: false, error: "Pipeline stage not found" }, { status: 404 })
  }

  const rules = await prisma.stageValidationRule.findMany({
    where: { pipelineStageId: id, organizationId: orgId },
    orderBy: { createdAt: "asc" },
  })

  return NextResponse.json({ success: true, data: rules })
})

// POST — create a validation rule
export const POST = withRlsAuth("settings", "write", async (req, { orgId }, { params }: RouteContext) => {
  const { id } = await params

  const parsed = ruleSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0].message }, { status: 400 })
  }

  const stage = await prisma.pipelineStage.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  })
  if (!stage) {
    return NextResponse.json({ success: false, error: "Pipeline stage not found" }, { status: 404 })
  }

  const { fieldName, ruleType, ruleValue, errorMessage } = parsed.data

  const rule = await prisma.stageValidationRule.create({
    data: {
      organizationId: orgId,
      pipelineStageId: id,
      fieldName,
      ruleType,
      ruleValue: RULES_WITH_VALUE.has(ruleType) ? String(ruleValue) : null,
      errorMessage,
    },
  })

  return NextResponse.json({ success: true, data: rule })
})

// DELETE — delete a validation rule
export const DELETE = withRlsAuth("settings", "delete", async (req, { orgId }, { params }: RouteContext) => {
  const { id } = await params
  const parsed = deleteRuleSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "A valid ruleId is required" }, { status: 400 })
  }

  const stage = await prisma.pipelineStage.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  })
  if (!stage) {
    return NextResponse.json({ success: false, error: "Pipeline stage not found" }, { status: 404 })
  }

  const deleted = await prisma.stageValidationRule.deleteMany({
    where: {
      id: parsed.data.ruleId,
      pipelineStageId: id,
      organizationId: orgId,
    },
  })
  if (deleted.count !== 1) {
    return NextResponse.json({ success: false, error: "Validation rule not found" }, { status: 404 })
  }

  return NextResponse.json({ success: true })
})
