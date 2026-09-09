export type AdvisorActionPreviewLabels = {
  taskTitle: string
  alertTitle: string
  noteSubject: string
  followupSubject: string
  budgetTitle: string
  description: string
  message: string
  body: string
  assignee: string
  priority: string
  amount: string
  relatedRecord: string
  company: string
  invoice: string
  daysOverdue: string
}

export type AdvisorActionPreviewEntry = {
  label: string
  value: string
}

export type AdvisorActionEditableField = {
  key: string
  label: string
  kind?: "input" | "textarea"
}

type AdvisorActionPreviewInput = {
  actionType: string
  entityType: string
  entityId: string
  payload: Record<string, unknown>
}

const advisorPreviewAliases: Record<string, string> = {
  create_followup_task: "create_task",
  quote_reminder: "create_task",
  unblock_task: "create_task",
  escalate_overdue_task: "create_task",
  bill_payment_escalation: "create_task",
  missed_visit_task: "create_task",
  coaching_task: "create_task",
  stage_alert: "create_alert",
  update_health_note: "create_note",
  route_issue: "flag_route_issue",
  approval_escalation: "contract_review",
  signature_reminder: "contract_review",
  segment_review_task: "campaign_review",
  enrollJourney: "enroll_journey",
}

function advisorPreviewActionType(actionType: string): string {
  return advisorPreviewAliases[actionType] || actionType
}

export function advisorPreviewValue(value: unknown): string {
  if (value == null || value === "") return "—"
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) return `${value.length} items`
  try {
    return JSON.stringify(value).slice(0, 120)
  } catch {
    return "—"
  }
}

function relatedRecordPreview(input: AdvisorActionPreviewInput) {
  const relatedType = typeof input.payload.relatedType === "string" ? input.payload.relatedType : input.entityType
  const relatedId = typeof input.payload.relatedId === "string" ? input.payload.relatedId : input.entityId
  if (/^c[a-z0-9]{16,}$/i.test(relatedId)) return relatedType
  return `${relatedType}:${relatedId}`
}

function compactPreviewEntries(entries: Array<AdvisorActionPreviewEntry | null>) {
  return entries.filter((entry): entry is AdvisorActionPreviewEntry => Boolean(entry && entry.value && entry.value !== "—")).slice(0, 6)
}

export function buildAdvisorActionPreviewEntries(input: AdvisorActionPreviewInput, labels: AdvisorActionPreviewLabels): AdvisorActionPreviewEntry[] {
  const payload = input.payload
  const typedEntries: Record<string, AdvisorActionPreviewEntry[]> = {
    create_task: compactPreviewEntries([
      { label: labels.taskTitle, value: advisorPreviewValue(payload.title) },
      { label: labels.description, value: advisorPreviewValue(payload.description) },
      { label: labels.assignee, value: advisorPreviewValue(payload.assignedTo) },
      { label: labels.relatedRecord, value: relatedRecordPreview(input) },
    ]),
    assign_task: compactPreviewEntries([
      { label: labels.taskTitle, value: advisorPreviewValue(payload.title) },
      { label: labels.description, value: advisorPreviewValue(payload.description) },
      { label: labels.assignee, value: advisorPreviewValue(payload.assignedTo) },
      { label: labels.relatedRecord, value: relatedRecordPreview(input) },
    ]),
    assign_owner: compactPreviewEntries([
      { label: labels.assignee, value: advisorPreviewValue(payload.assignedTo) },
      { label: labels.description, value: advisorPreviewValue(payload.description) },
      { label: labels.relatedRecord, value: relatedRecordPreview(input) },
    ]),
    assign_ticket_owner: compactPreviewEntries([
      { label: labels.assignee, value: advisorPreviewValue(payload.assignedTo) },
      { label: labels.description, value: advisorPreviewValue(payload.description) },
      { label: labels.relatedRecord, value: relatedRecordPreview(input) },
    ]),
    create_alert: compactPreviewEntries([
      { label: labels.alertTitle, value: advisorPreviewValue(payload.title) },
      { label: labels.message, value: advisorPreviewValue(payload.description || payload.message) },
      { label: labels.relatedRecord, value: relatedRecordPreview(input) },
    ]),
    priority_update: compactPreviewEntries([
      { label: labels.priority, value: advisorPreviewValue(payload.priority || "high") },
      { label: labels.message, value: advisorPreviewValue(payload.description || payload.message) },
      { label: labels.relatedRecord, value: relatedRecordPreview(input) },
    ]),
    invoice_reminder: compactPreviewEntries([
      { label: labels.taskTitle, value: advisorPreviewValue(payload.title) },
      { label: labels.message, value: advisorPreviewValue(payload.message || payload.description) },
      { label: labels.relatedRecord, value: relatedRecordPreview(input) },
    ]),
    flag_route_issue: compactPreviewEntries([
      { label: labels.alertTitle, value: advisorPreviewValue(payload.title) },
      { label: labels.message, value: advisorPreviewValue(payload.description || payload.message) },
      { label: labels.relatedRecord, value: relatedRecordPreview(input) },
    ]),
    contract_review: compactPreviewEntries([
      { label: labels.taskTitle, value: advisorPreviewValue(payload.title) },
      { label: labels.description, value: advisorPreviewValue(payload.description) },
      { label: labels.assignee, value: advisorPreviewValue(payload.assignedTo) },
      { label: labels.relatedRecord, value: relatedRecordPreview(input) },
    ]),
    campaign_review: compactPreviewEntries([
      { label: labels.taskTitle, value: advisorPreviewValue(payload.title) },
      { label: labels.description, value: advisorPreviewValue(payload.description) },
      { label: labels.assignee, value: advisorPreviewValue(payload.assignedTo) },
      { label: labels.relatedRecord, value: relatedRecordPreview(input) },
    ]),
    support_escalation: compactPreviewEntries([
      { label: labels.alertTitle, value: advisorPreviewValue(payload.title) },
      { label: labels.message, value: advisorPreviewValue(payload.description || payload.message) },
      { label: labels.assignee, value: advisorPreviewValue(payload.assignedTo) },
      { label: labels.relatedRecord, value: relatedRecordPreview(input) },
    ]),
    kpi_plan_review: compactPreviewEntries([
      { label: labels.taskTitle, value: advisorPreviewValue(payload.title) },
      { label: labels.description, value: advisorPreviewValue(payload.description) },
      { label: labels.assignee, value: advisorPreviewValue(payload.assignedTo) },
      { label: labels.relatedRecord, value: relatedRecordPreview(input) },
    ]),
    create_note: compactPreviewEntries([
      { label: labels.noteSubject, value: advisorPreviewValue(payload.subject) },
      { label: labels.description, value: advisorPreviewValue(payload.description || payload.body) },
      { label: labels.relatedRecord, value: relatedRecordPreview(input) },
    ]),
    draft_followup: compactPreviewEntries([
      { label: labels.followupSubject, value: advisorPreviewValue(payload.subject) },
      { label: labels.body, value: advisorPreviewValue(payload.body) },
      { label: labels.relatedRecord, value: relatedRecordPreview(input) },
    ]),
    suggest_budget_change: compactPreviewEntries([
      { label: labels.budgetTitle, value: advisorPreviewValue(payload.title) },
      { label: labels.description, value: advisorPreviewValue(payload.description || payload.reasoning) },
      { label: labels.relatedRecord, value: relatedRecordPreview(input) },
    ]),
    enroll_journey: compactPreviewEntries([
      { label: labels.invoice, value: advisorPreviewValue(payload.invoiceNumber) },
      { label: labels.company, value: advisorPreviewValue(payload.companyName) },
      { label: labels.amount, value: advisorPreviewValue(payload.amount) },
      { label: labels.daysOverdue, value: advisorPreviewValue(payload.daysOverdue) },
    ]),
  }
  const previewType = advisorPreviewActionType(input.actionType)
  if (typedEntries[previewType]?.length) return typedEntries[previewType]

  const fallbackLabels: Record<string, string> = {
    companyName: labels.company,
    invoiceNumber: labels.invoice,
    daysOverdue: labels.daysOverdue,
    amount: labels.amount,
    assignedTo: labels.assignee,
    relatedType: labels.relatedRecord,
    relatedId: "ID",
  }
  const preferredKeys = ["title", "subject", "description", "companyName", "invoiceNumber", "amount", "daysOverdue", "assignedTo", "body", "relatedType", "relatedId"]
  const entries = preferredKeys
    .filter((key) => key in payload)
    .map((key) => ({ label: fallbackLabels[key] || key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase()), value: advisorPreviewValue(payload[key]) }))
  if (entries.length > 0) return entries.slice(0, 5)
  return Object.entries(payload)
    .filter(([key]) => key !== "advisor")
    .slice(0, 5)
    .map(([key, value]) => ({ label: key, value: advisorPreviewValue(value) }))
}

function payloadTextKey(payload: Record<string, unknown>, preferred: string, fallback: string) {
  return preferred in payload ? preferred : fallback
}

export function buildAdvisorEditablePayloadFields(actionType: string, payload: Record<string, unknown>, labels: AdvisorActionPreviewLabels): AdvisorActionEditableField[] {
  const relatedFields: AdvisorActionEditableField[] = [
    { key: "relatedType", label: labels.relatedRecord },
    { key: "relatedId", label: "ID" },
  ]
  const byType: Record<string, AdvisorActionEditableField[]> = {
    create_task: [
      { key: "title", label: labels.taskTitle },
      { key: "description", label: labels.description, kind: "textarea" },
      { key: "assignedTo", label: labels.assignee },
      ...relatedFields,
    ],
    assign_task: [
      { key: "title", label: labels.taskTitle },
      { key: "description", label: labels.description, kind: "textarea" },
      { key: "assignedTo", label: labels.assignee },
      ...relatedFields,
    ],
    assign_owner: [
      { key: "title", label: labels.taskTitle },
      { key: "description", label: labels.description, kind: "textarea" },
      { key: "assignedTo", label: labels.assignee },
      ...relatedFields,
    ],
    assign_ticket_owner: [
      { key: "title", label: labels.taskTitle },
      { key: "description", label: labels.description, kind: "textarea" },
      { key: "assignedTo", label: labels.assignee },
      ...relatedFields,
    ],
    create_alert: [
      { key: "title", label: labels.alertTitle },
      { key: payloadTextKey(payload, "message", "description"), label: labels.message, kind: "textarea" },
      ...relatedFields,
    ],
    priority_update: [
      { key: "priority", label: labels.priority },
      { key: "title", label: labels.alertTitle },
      { key: payloadTextKey(payload, "message", "description"), label: labels.message, kind: "textarea" },
      ...relatedFields,
    ],
    invoice_reminder: [
      { key: "title", label: labels.taskTitle },
      { key: payloadTextKey(payload, "message", "description"), label: labels.message, kind: "textarea" },
      ...relatedFields,
    ],
    flag_route_issue: [
      { key: "title", label: labels.alertTitle },
      { key: payloadTextKey(payload, "message", "description"), label: labels.message, kind: "textarea" },
      ...relatedFields,
    ],
    contract_review: [
      { key: "title", label: labels.taskTitle },
      { key: "description", label: labels.description, kind: "textarea" },
      { key: "assignedTo", label: labels.assignee },
      ...relatedFields,
    ],
    campaign_review: [
      { key: "title", label: labels.taskTitle },
      { key: "description", label: labels.description, kind: "textarea" },
      { key: "assignedTo", label: labels.assignee },
      ...relatedFields,
    ],
    support_escalation: [
      { key: "title", label: labels.alertTitle },
      { key: payloadTextKey(payload, "message", "description"), label: labels.message, kind: "textarea" },
      { key: "assignedTo", label: labels.assignee },
      ...relatedFields,
    ],
    kpi_plan_review: [
      { key: "title", label: labels.taskTitle },
      { key: "description", label: labels.description, kind: "textarea" },
      { key: "assignedTo", label: labels.assignee },
      ...relatedFields,
    ],
    create_note: [
      { key: "subject", label: labels.noteSubject },
      { key: payloadTextKey(payload, "body", "description"), label: labels.description, kind: "textarea" },
      ...relatedFields,
    ],
    draft_followup: [
      { key: "subject", label: labels.followupSubject },
      { key: "body", label: labels.body, kind: "textarea" },
      ...relatedFields,
    ],
    suggest_budget_change: [
      { key: "title", label: labels.budgetTitle },
      { key: payloadTextKey(payload, "reasoning", "description"), label: labels.description, kind: "textarea" },
      ...relatedFields,
    ],
  }
  return byType[advisorPreviewActionType(actionType)] || []
}
