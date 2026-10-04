/** Browser projection of an original creation receipt; it carries no live policy state. */
export type WorkforcePolicyRestoreSource = {
  id: string; name: string; version: number; status: "ACTIVE" | "RETIRED"
  definitionHash: string; teamId: string | null; teamName: string | null
}
export type WorkforcePolicyRestoreRequest = {
  operationId: string; expectedSourceVersion: number; expectedSourceDefinitionHash: string
  name: string; effectiveFrom: string
}
export type WorkforcePolicyRestoreCreation = {
  policyId: string; teamId: string | null; version: number; name: string
  effectiveFrom: string; effectiveTo: null; definitionHash: string; createdAt: string
  statusAtCreation: "DRAFT"; sourcePolicyId: string; sourceVersion: number
}
export type WorkforcePolicyRestoreReceipt = {
  schemaVersion: 1; basis: "CREATION_RECEIPT_ONLY_NOT_CURRENT_STATE"; replayed: boolean
  creation: WorkforcePolicyRestoreCreation
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 191
  && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value)
export function workforcePolicyRestoreDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false
  const date = new Date(value + "T00:00:00.000Z")
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
export function validWorkforcePolicyRestoreReceipt(value: unknown, status: number,
  source: WorkforcePolicyRestoreSource, request: WorkforcePolicyRestoreRequest): value is WorkforcePolicyRestoreReceipt {
  if (!object(value) || value.schemaVersion !== 1 || value.basis !== "CREATION_RECEIPT_ONLY_NOT_CURRENT_STATE"
    || request.expectedSourceVersion !== source.version || request.expectedSourceDefinitionHash !== source.definitionHash
    || !((status === 201 && value.replayed === false) || (status === 200 && value.replayed === true))
    || !object(value.creation)) return false
  const row = value.creation
  return id(row.policyId) && row.policyId !== source.id && row.teamId === source.teamId
    && typeof row.version === "number" && Number.isSafeInteger(row.version) && row.version > source.version
    && row.name === request.name && row.effectiveFrom === request.effectiveFrom && row.effectiveTo === null
    && row.definitionHash === request.expectedSourceDefinitionHash && row.statusAtCreation === "DRAFT"
    && row.sourcePolicyId === source.id && row.sourceVersion === request.expectedSourceVersion
    && typeof row.createdAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(row.createdAt)
    && Number.isFinite(new Date(row.createdAt).getTime()) && new Date(row.createdAt).toISOString() === row.createdAt
}
