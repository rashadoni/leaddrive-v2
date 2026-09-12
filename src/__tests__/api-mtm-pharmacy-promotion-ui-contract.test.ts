import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const workspacePath = "src/components/mtm/pharmacy-promotion-workspace.tsx"
const detailPath = "src/components/mtm/pharmacy-promotion-detail.tsx"
const agentCapturePath = "src/components/mtm/pharmacy-promotion-agent-capture.tsx"
const definitionAdminPath = "src/components/mtm/pharmacy-promotion-definition-admin.tsx"
const campaignAdminPath = "src/components/mtm/pharmacy-promotion-campaign-admin.tsx"
const outboxSyncPath = "src/components/mtm/pharmacy-promotion-outbox-sync.tsx"
const outboxPath = "src/lib/mtm/pharmacy-promotion-outbox.ts"
const dashboardLayoutPath = "src/app/(dashboard)/layout.tsx"
const exportPath = "src/app/api/v1/mtm/pharmacy-promotion-executions/export/route.ts"

function source(path: string) {
  return readFileSync(path, "utf8")
}

function leafPaths(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [prefix]
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, entry]) => leafPaths(entry, prefix ? `${prefix}.${key}` : key))
}

describe("SWM-09 pharmacy promotion UI contract", () => {
  it("keeps every reference filter in URL state and exposes responsive table/card projections", () => {
    const ui = source(workspacePath)
    for (const filter of [
      "departmentId", "employeeId", "regionId", "localityId", "territoryId",
      "contactId", "promotionId", "promotionType", "code", "managerId",
      "userGroupId", "executionStatus", "controlledVisitStatus", "l1Status",
      "l2Status", "ready", "dateMode", "dateFrom", "dateTo", "amountMode",
      "amountMin", "amountMax", "pageSize", "columns", "density",
    ]) {
      expect(ui, `missing filter ${filter}`).toContain(`"${filter}"`)
    }
    expect(ui).toContain('className="hidden overflow-x-auto xl:block"')
    expect(ui).toContain('className="grid gap-3 p-3 xl:hidden md:grid-cols-2"')
    expect(ui).toContain('data-testid="mtm-pharmacy-tablet-master-detail"')
    expect(ui).toContain('data-testid="mtm-pharmacy-filter-sheet"')
    expect(ui).toContain('data-testid="mtm-pharmacy-filter-scroll"')
    expect(ui).toContain('data-execution-id={focusedRow.id}')
    expect(ui).toContain('data-source-visible={visibleColumns.has("source")}')
    expect(ui).toContain("row.target.planQuantity")
    expect(ui).toContain("row.factQuantity")
    expect(ui).toContain("row.evidenceCount")
    expect(ui).toContain("row.nextResponsible")
    expect(ui).toContain('data-testid={`mtm-pharmacy-promotion-${row.id}`}')
    expect(ui).toContain('data-testid={`mtm-pharmacy-review-${row.id}`}')
    expect(ui).toContain('data-testid="mtm-pharmacy-review-dialog"')
  })

  it("reuses one review operation ID across apply retries", () => {
    const ui = source(workspacePath)
    expect(ui).toContain('const [operationId, setOperationId] = useState<string | null>(null)')
    expect(ui.match(/crypto\.randomUUID\(\)/g)).toHaveLength(1)
    expect(ui).toContain("if (!preview || !operationId) return")
  })

  it("connects the durable browser outbox to the production agent submit action", () => {
    const detail = source(detailPath)
    expect(detail).toContain("createPharmacyPromotionSubmitOperation")
    expect(detail).toContain("persistPharmacyPromotionOperation(entry)")
    expect(detail).toContain("flushPharmacyPromotionOutbox")
    expect(detail).toContain("sendPharmacyPromotionOutboxRequests")
    expect(detail).toContain('window.addEventListener("online", flushIfOnline)')
    expect(detail).toContain('detail.permissions?.canSubmit && detail.status === "DRAFT"')
    expect(detail).toContain("listPharmacyPromotionOutboxEntries(detail.syncScopeKey, detail.id)")
    expect(detail).toContain("retryPharmacyPromotionOperationNow")
    expect(detail).toContain("removePharmacyPromotionOutboxEntries")
    expect(detail).toContain("detail.policy?.ready !== true")
    expect(detail).toContain("workflowMutationRef")
    expect(detail).toContain('crypto.subtle.digest("SHA-256"')
    expect(detail).toContain("createPharmacyPromotionEvidenceOperation")
    expect(detail).toContain("file: evidenceFile")
    expect(detail).toContain('setEvidenceMessage(t("evidenceQueued"))')
    expect(detail).not.toContain('setEvidenceError(t("evidenceOnlineRequired"))')
    const outbox = source(outboxPath)
    expect(outbox).toContain('formData.set("clientEvidenceId"')
    expect(outbox).toContain('kind: "EVIDENCE"')
    expect(outbox).toContain("binary: input.file")
    expect(source(outboxSyncPath)).toContain("scopeKey: context.scopeKey")
    expect(source(dashboardLayoutPath)).toContain("<PharmacyPromotionOutboxSync")
    const capture = source(agentCapturePath)
    expect(capture).toContain("createPharmacyPromotionDraftOperation")
    expect(capture).toContain("persistPharmacyPromotionOperation(entry)")
    expect(capture).toContain('fetch("/api/v1/mtm/pharmacy-promotion-targets"')
    expect(capture).toContain("supersedesExecutionId: selectedCorrection.id")
    expect(capture).toContain("visitId: selectedVisit.id")
    expect(capture).toContain("normalizePharmacyPromotionHumanDecimal18_4(factQuantity)")
    expect(capture).toContain("readPharmacyPromotionTargetCache(scopeKey)")
    expect(capture).toContain("writePharmacyPromotionTargetCache(scopeKey, nextTargets)")
    expect(source(workspacePath)).toContain("<PharmacyPromotionAgentCapture")
    // The outbox sync keeps the key that carries the token rotation; the page
    // subtree must never be keyed on it. That key embeds session.iat, which
    // changes on every JWT re-issue, so it remounted the whole dashboard a
    // second after load and wiped whatever the user had already typed
    // (post-deploy smoke flakes, 2026-08-11). The page is keyed on identity
    // alone, which still resets it when the account changes.
    expect(source(dashboardLayoutPath)).toContain("<PharmacyPromotionOutboxSync sessionKey={outboxSessionKey} />")
    expect(source(dashboardLayoutPath)).toContain("<MotionPage key={sessionIdentity}")
    expect(source(dashboardLayoutPath)).not.toContain("<MotionPage key={outboxSessionKey}>")
  })

  it("partitions the IndexedDB v4 queue/cache and serializes drains across tabs", () => {
    const outbox = source(outboxPath)
    expect(outbox).toContain("const DB_VERSION = 4")
    expect(outbox).toContain('keyPath: ["scopeKey", "operationId"]')
    expect(outbox).toContain('store.get([entry.scopeKey, entry.operationId])')
    expect(outbox).toContain('store.delete([normalizedScope, operationId])')
    expect(outbox).toContain('store.createIndex("scopeKey", "scopeKey"')
    expect(outbox).toContain('store.index("scopeKey").getAll(normalizedScope)')
    expect(outbox).toContain("left.scopeKey === right.scopeKey")
    expect(outbox).toContain("clientOccurredAt: input.clientOccurredAt !== undefined")
    expect(outbox).toContain('const TARGET_CACHE_STORE_NAME = "targetAssignments"')
    expect(outbox).toContain("runWithPharmacyPromotionCrossTabLock(scopeKey, drain)")
    expect(outbox).toContain("lockManager.request(`leaddrive:mtm:pharmacy-promotion:${scopeKey}`")
  })

  it("keeps RU/AZ/EN promotion keys aligned and does not expose the backlog ID", () => {
    const messages = ["ru", "az", "en"].map((locale) => JSON.parse(
      source(`messages/${locale}.json`),
    ).mtmPharmacyPromotions as Record<string, unknown>)
    const baseline = leafPaths(messages[0]).sort()
    expect(leafPaths(messages[1]).sort()).toEqual(baseline)
    expect(leafPaths(messages[2]).sort()).toEqual(baseline)
    expect(source(workspacePath)).not.toContain("SWM-09")
    expect(source(detailPath)).not.toMatch(/:\s*(detail|row|entry|event)\.(status|kind|bucket|entryType|eventType)\s*}/)
    expect(source(agentCapturePath)).not.toContain("SWM-09")
  })

  it("exposes the governed definition catalog without inventing commercial defaults", () => {
    const admin = source(definitionAdminPath)
    expect(source(workspacePath)).toContain("<PharmacyPromotionDefinitionAdmin")
    for (const endpoint of [
      "/api/v1/mtm/pharmacy-promotion-types",
      "/api/v1/mtm/pharmacy-points-formulas",
      "/api/v1/mtm/pharmacy-approval-policies",
    ]) expect(admin).toContain(endpoint)
    expect(admin).toContain("expectedDefinitionHash: activation.definitionHash")
    expect(admin).toContain("approvalReference: approvalReference.trim()")
    expect(admin).toContain("sourceReference: formulaForm.sourceReference")
    expect(admin).toContain("sourceReference: policyForm.sourceReference")
    expect(admin).toContain("window.confirm(t(\"activateTypeConfirm\"")
    expect(admin).not.toMatch(/factPointsPerUnit:\s*["']?\d/)
    expect(admin).not.toMatch(/rewardPointsPerUnit:\s*["']?\d/)
  })

  it("authors and publishes immutable campaign revisions by server hash", () => {
    const admin = source(campaignAdminPath)
    expect(source(workspacePath)).toContain("<PharmacyPromotionCampaignAdmin")
    expect(admin).toContain('url: "/api/v1/mtm/pharmacy-promotions"')
    expect(admin).toContain("/versions`")
    expect(admin).toContain("`${base}/publish`")
    expect(admin).toContain("`${base}/retire`")
    expect(admin).toContain("expectedDefinitionHash: action.definitionHash")
    expect(admin).toContain("eligibilityApprovalReference: eligibilityApprovalReference.trim()")
    expect(admin).toContain("sourceReference: versionForm.sourceReference")
    expect(admin).not.toMatch(/minimumEvidenceCount:\s*\d/)
    expect(admin).not.toMatch(/timezone:\s*["'][A-Za-z]+\//)
  })

  it("localizes export lifecycle values instead of returning raw enums", () => {
    const ui = source(workspacePath)
    const csv = source(exportPath)
    expect(ui).toContain('query.set("locale", locale)')
    expect(csv).toContain("localizedValue(valueCopy[locale].execution, row.status")
    expect(csv).toContain("localizedValue(valueCopy[locale].visit, row.visit?.status")
    expect(csv).toContain("localizedValue(valueCopy[locale].review, row.l1State")
    expect(csv).toContain("localizedValue(valueCopy[locale].source, row.sourceSystem")
  })
})
