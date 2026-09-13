export type ComplaintDraftForm = {
  customerName: string
  phone: string
  source: string
  complaintType: string
  brand: string
  productionArea: string
  productCategory: string
  complaintObject: string
  complaintObjectDetail: string
  content: string
  responsibleDepartment: string
  riskLevel: string
}

export type ComplaintDraft = { form: ComplaintDraftForm; updatedAt: string }

const fields: Array<keyof ComplaintDraftForm> = [
  "customerName", "phone", "source", "complaintType", "brand", "productionArea",
  "productCategory", "complaintObject", "complaintObjectDetail", "content",
  "responsibleDepartment", "riskLevel",
]

export function complaintDraftStorageKey(organizationId: string): string {
  return `complaints:new:draft:${organizationId}`
}

export function hasComplaintDraftContent(form: ComplaintDraftForm): boolean {
  return fields.some((field) => {
    if (field === "source") return form[field] !== "hotline"
    if (field === "complaintType") return form[field] !== "complaint"
    if (field === "riskLevel") return form[field] !== "medium"
    return Boolean(form[field].trim())
  })
}

export function serializeComplaintDraft(form: ComplaintDraftForm, updatedAt = new Date()): string {
  return JSON.stringify({ form, updatedAt: updatedAt.toISOString() } satisfies ComplaintDraft)
}

export function parseComplaintDraft(raw: string | null): ComplaintDraft | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<ComplaintDraft>
    if (!value.form || typeof value.updatedAt !== "string") return null
    for (const field of fields) if (typeof value.form[field] !== "string") return null
    if (!hasComplaintDraftContent(value.form)) return null
    return { form: value.form, updatedAt: value.updatedAt }
  } catch {
    return null
  }
}
