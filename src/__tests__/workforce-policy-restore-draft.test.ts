import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { Prisma } from "@prisma/client"
import { workforcePolicyDefinitionHash } from "@/lib/workforce/policy-definition"

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), policy: vi.fn(), audits: vi.fn(), create: vi.fn(),
  latest: vi.fn(), auditCreate: vi.fn(), execute: vi.fn(), setting: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }))
vi.mock("@/lib/mtm-settings", () => ({ MTM_SETTING_DEFAULTS: { timezone: "Asia/Baku" } }))
import { restoreWorkforcePolicyAsDraft, workforcePolicyRestoreRequestHash } from "@/lib/workforce/policy-restore-draft"
import { workforcePolicyScopeLock } from "@/lib/workforce/policy-draft-write"

const definition = { expectedWorkSeconds: 0, lateGraceSeconds: 0, undertimeToleranceSeconds: 0,
  overtimeThresholdSeconds: 0, longPauseThresholdSeconds: null, opaque: { nested: [null, 0, { preserved: true }] } }
const definitionHash = workforcePolicyDefinitionHash(definition)
const draft = { operationId: "restore:example", expectedSourceVersion: 3, expectedSourceDefinitionHash: definitionHash,
  name: "Restored draft", effectiveFrom: "2026-10-05" }
const input = { organizationId: "org", sourcePolicyId: "source", draft, audit: { actorUserId: "actor" } }
const source = { id: "source", organizationId: "org", teamId: null, version: 3, status: "ACTIVE", definition, definitionHash }
const createdAt = new Date("2026-10-04T23:30:00Z")
function anchor() { return { id: "created", organizationId: "org", teamId: null, version: 5, createdByUserId: "actor", createdAt,
  restoreOperationId: draft.operationId, restoreRequestHash: workforcePolicyRestoreRequestHash("org", "source", draft) } }
function audit() { return { organizationId: "org", entityId: draft.operationId, metadataKind: "workforce_configuration", actorUserId: "actor",
  newData: { schemaVersion: 1, organizationId: "org", operationId: draft.operationId, requestHash: anchor().restoreRequestHash,
    source: { id: "source", version: 3, definitionHash }, result: { id: "created", teamId: null, version: 5, createdByUserId: "actor",
      createdAt: createdAt.toISOString(), statusAtCreation: "DRAFT", provenanceAtCreation: "TENANT_ADMIN", name: draft.name,
      effectiveFrom: draft.effectiveFrom, effectiveTo: null, definitionHash } } } }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(createdAt)
  for (const fn of Object.values(mocks)) fn.mockReset()
  mocks.policy.mockImplementation(async ({ where, select }) => where.restoreOperationId ? null : select.definition ? source : { version: 4 })
  mocks.audits.mockResolvedValue([]); mocks.setting.mockResolvedValue({ value: "UTC" })
  mocks.create.mockImplementation(async ({ data }) => ({ ...data, id: "created", createdAt, updatedAt: createdAt }))
  mocks.transaction.mockImplementation(async (handler: (tx: unknown) => Promise<unknown>) => handler({
    workforcePolicy: { findFirst: mocks.policy, create: mocks.create }, mtmAuditLog: { findMany: mocks.audits, create: mocks.auditCreate },
    $executeRaw: mocks.execute, mtmSetting: { findFirst: mocks.setting },
  }))
})
afterEach(() => vi.useRealTimers())

describe("bounded canonical restore draft transaction", () => {
  it("copies the full opaque canonical JSON and NULL/0, allocates in exact legacy scope, one anchored row/one atomic audit", async () => {
    const result = await restoreWorkforcePolicyAsDraft(input)
    expect(result.replayed).toBe(false); expect(result.creation.version).toBe(5)
    expect(result.basis).toBe("CREATION_RECEIPT_ONLY_NOT_CURRENT_STATE")
    expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.auditCreate).toHaveBeenCalledTimes(1)
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({ definition, definitionHash, status: "DRAFT", provenance: "TENANT_ADMIN",
      systemProfileVersion: null, createdByUserId: "actor", teamId: null, effectiveTo: null,
      restoreOperationId: draft.operationId, restoreRequestHash: anchor().restoreRequestHash })
    expect(mocks.auditCreate.mock.calls[0][0].data).toMatchObject({ action: "WORKFORCE_POLICY_RESTORED_AS_DRAFT", actorUserId: "actor",
      entityId: draft.operationId, newData: audit().newData })
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 20000 })
    const locks = mocks.execute.mock.calls.slice(1).map(call => call[1])
    expect(locks).toEqual([workforcePolicyScopeLock("org", null), "workforce-policy-restore:org:restore:example"].sort())
    expect(mocks.policy.mock.calls.filter(call => call[0].select.definition)).toHaveLength(2)
  })
  it("exact replay precedes today's date/source reads and keeps the original creator when another authorized actor retries", async () => {
    vi.setSystemTime(new Date("2026-10-10T12:00:00Z"))
    mocks.policy.mockResolvedValue(anchor()); mocks.audits.mockResolvedValue([audit()])
    const result = await restoreWorkforcePolicyAsDraft({ ...input, audit: { actorUserId: "other-actor" } })
    expect(result.replayed).toBe(true); expect(result.creation.createdAt).toBe(createdAt.toISOString())
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.auditCreate).not.toHaveBeenCalled(); expect(mocks.setting).not.toHaveBeenCalled()
    expect(mocks.policy.mock.calls.every(call => call[0].where.restoreOperationId === draft.operationId)).toBe(true)
  })
  it("resolves a pre-lock anchor/audit read straddling an atomic concurrent commit by rereading under both locks", async () => {
    mocks.policy.mockResolvedValueOnce(null).mockResolvedValue(anchor()); mocks.audits.mockResolvedValue([audit()])
    expect((await restoreWorkforcePolicyAsDraft(input)).replayed).toBe(true)
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it.each(["anchor-only", "receipt-only", "malformed", "duplicate", "wrong-creator", "wrong-result"])("fails closed for %s and does not create a replacement", async kind => {
    mocks.policy.mockResolvedValue(kind === "receipt-only" ? null : anchor())
    const row = audit()
    if (kind === "malformed") row.newData.schemaVersion = 2
    if (kind === "wrong-creator") row.actorUserId = "other"
    if (kind === "wrong-result") row.newData.result.id = "other"
    mocks.audits.mockResolvedValue(kind === "anchor-only" ? [] : kind === "duplicate" ? [row, row] : [row])
    await expect(restoreWorkforcePolicyAsDraft(input)).rejects.toMatchObject({ code: "WORKFORCE_POLICY_RESTORE_INTEGRITY_INVALID" })
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.auditCreate).not.toHaveBeenCalled()
  })
  it("rejects an operation reused with different immutable request fields", async () => {
    mocks.policy.mockResolvedValue(anchor()); mocks.audits.mockResolvedValue([audit()])
    await expect(restoreWorkforcePolicyAsDraft({ ...input, draft: { ...draft, name: "Different" } })).rejects.toMatchObject({ code: "WORKFORCE_POLICY_RESTORE_OPERATION_CONFLICT" })
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it.each(["DRAFT", "foreign-missing", "changed-version", "hash-drift", "opaque-drift", "scope-drift"])("rejects source %s before writes", async kind => {
    let calls = 0
    mocks.policy.mockImplementation(async ({ where }) => {
      if (where.restoreOperationId) return null
      calls++
      if (kind === "foreign-missing") return null
      return { ...source, ...(kind === "DRAFT" ? { status: "DRAFT" } : kind === "changed-version" ? { version: 7 }
        : kind === "hash-drift" ? { definitionHash: "0".repeat(64) }
          : kind === "opaque-drift" ? { definition: { ...definition, opaque: {} } }
            : kind === "scope-drift" && calls === 2 ? { teamId: "other-team" } : {}) }
    })
    await expect(restoreWorkforcePolicyAsDraft(input)).rejects.toBeInstanceOf(Error)
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.auditCreate).not.toHaveBeenCalled()
  })
  it.each([null, { value: null }, { value: 3 }])("uses Baku default and observes the date after waiting for locks: %s", async setting => {
    mocks.setting.mockResolvedValue(setting)
    await expect(restoreWorkforcePolicyAsDraft(input)).rejects.toMatchObject({ code: "WORKFORCE_POLICY_RESTORE_NOT_FUTURE" })
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it("invalid configured timezone falls back to UTC", async () => {
    mocks.setting.mockResolvedValue({ value: "Invalid/Timezone" }); expect((await restoreWorkforcePolicyAsDraft(input)).replayed).toBe(false)
  })
  it("does not use a pre-lock server date for fresh creation", async () => {
    mocks.execute.mockImplementationOnce(async () => 1).mockImplementation(async () => { vi.setSystemTime(new Date("2026-10-05T00:01:00Z")); return 1 })
    await expect(restoreWorkforcePolicyAsDraft(input)).rejects.toMatchObject({ code: "WORKFORCE_POLICY_RESTORE_NOT_FUTURE" })
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it("audit failure is propagated from the single transaction, with no success receipt", async () => {
    mocks.auditCreate.mockRejectedValue(new Error("audit rejected"))
    await expect(restoreWorkforcePolicyAsDraft(input)).rejects.toThrow("audit rejected")
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    // Actual rollback, connection and concurrency guarantees require hosted real PostgreSQL.
  })
  it.each([{ operationId: "short" }, { organizationId: "foreign" }, { effectiveFrom: "2026-02-30" },
    { expectedSourceVersion: Number.MAX_SAFE_INTEGER + 1 }, { expectedSourceDefinitionHash: "abc" }, { definition }])("rejects invalid/unknown caller fields %s before storage", async patch => {
    await expect(restoreWorkforcePolicyAsDraft({ ...input, draft: { ...draft, ...patch } })).rejects.toMatchObject({ code: "WORKFORCE_POLICY_RESTORE_INPUT_INVALID" })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})
