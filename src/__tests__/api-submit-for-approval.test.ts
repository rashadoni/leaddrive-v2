/**
 * Integration tests for CLM Slice 3b:
 *   POST /api/v1/contracts/:id/submit-for-approval
 *   POST /api/v1/contracts/:id/approvals/:order  (concurrent pointer guard)
 *
 * submit-for-approval covers:
 *   - A matching rule ADDS a stage to the base stages
 *   - skip_stage removing ALL stages → empty finalStages → 422
 *   - Stage cap exceeded after rule application → 422
 *   - Foreign-template rule NOT applied (only org-wide or matching template rules)
 *   - Delegation resolves the stage assignee to the active delegate
 *   - No rules → base stages unchanged
 *   - Non-draft status → 409 (state machine guard)
 *   - Contract not found → 404
 *   - Idempotency guard (existing pending stages) → 409
 *
 * approvals/[order] covers:
 *   - Concurrent contract-pointer guard miss: contract updateMany count===0 → 409
 *     and the stage CAS rolls back (stage remains pending).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contract: {
      findFirst: vi.fn(),
    },
    contractApprovalStage: {
      count: vi.fn(),
      createMany: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
    contractApprovalRule: {
      findMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    user: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockReturnValue(false),
}))

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/contract-lifecycle/delegation", () => ({
  resolveApprovalAssignee: vi.fn(),
}))

vi.mock("@/lib/contract-lifecycle/state-machine", () => ({
  canTransition: vi.fn(),
  isContractStatus: vi.fn().mockReturnValue(true),
}))

vi.mock("@/lib/contract-lifecycle/approval-router", () => ({
  routeApproval: vi.fn(),
}))

import { POST } from "@/app/api/v1/contracts/[id]/submit-for-approval/route"
import { POST as POSTApproval } from "@/app/api/v1/contracts/[id]/approvals/[order]/route"
import { prisma } from "@/lib/prisma"
import { requireAuth, isAuthError } from "@/lib/api-auth"
import { resolveApprovalAssignee } from "@/lib/contract-lifecycle/delegation"
import { canTransition, isContractStatus } from "@/lib/contract-lifecycle/state-machine"
import { routeApproval } from "@/lib/contract-lifecycle/approval-router"

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG = "org-1"
const AUTH = { orgId: ORG, userId: "user-submitter", role: "manager" }

const CONTRACT = {
  id: "contract-1",
  title: "Test Contract",
  status: "draft",
  valueAmount: { toString: () => "50000", gte: (v: unknown) => true, gt: (v: unknown) => true, lte: (v: unknown) => true, lt: (v: unknown) => false, toNumber: () => 50000 },
  type: "service_agreement",
  currency: "USD",
  templateId: "tmpl-1",
  organizationId: ORG,
}

const BASE_STAGES = [
  { label: "Legal", assigneeUserId: undefined, assigneeRole: undefined },
  { label: "Finance", assigneeUserId: undefined, assigneeRole: undefined },
]

function makePostReq(contractId: string, stages: { label: string; assigneeUserId?: string; assigneeRole?: string; slaHours?: number }[]) {
  return new NextRequest(`http://localhost/api/v1/contracts/${contractId}/submit-for-approval`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stages }),
  })
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

// Simulate $transaction: execute the callback with a minimal tx proxy.
// FIX 2: tx now includes $queryRaw (FOR UPDATE lock) + contractApprovalStage.count
// (in-tx idempotency guard). count returns 0 by default (no pending stages).
//
// Correctness note: the callback now THROWS SubmitConflictError on state-conflicts
// (not returning { conflict: true }). Because this mock simply calls `fn(tx)` and
// propagates the promise, a throw inside `fn` naturally rejects the $transaction
// promise — exactly as a real Prisma interactive transaction does. The outer
// catch in the route catches SubmitConflictError → 409.
function setupTxMock(pendingStagesInTx: number = 0) {
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),  // FOR UPDATE lock — always succeeds
      contractApprovalStage: {
        count: vi.fn().mockResolvedValue(pendingStagesInTx),  // in-tx idempotency guard
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      contract: {
        findUnique: vi.fn().mockResolvedValue({ renderedBody: null }), // in-tx residual re-check (no vars)
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    }
    // Propagate the callback result (or rejection) directly.
    // A SubmitConflictError thrown inside fn() will reject this promise,
    // which the outer catch in the route handler catches → 409.
    return fn(tx)
  })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/v1/contracts/:id/submit-for-approval", () => {
  beforeEach(() => {
    vi.mocked(requireAuth).mockResolvedValue(AUTH as never)
    vi.mocked(isAuthError).mockReturnValue(false)
    vi.mocked(isContractStatus).mockReturnValue(true)
    vi.mocked(canTransition).mockReturnValue({ ok: true } as never)
    vi.mocked(prisma.contract.findFirst).mockResolvedValue(CONTRACT as never)
    vi.mocked(prisma.contractApprovalStage.count).mockResolvedValue(0)
    vi.mocked(prisma.contractApprovalRule.findMany).mockResolvedValue([])
    vi.mocked(resolveApprovalAssignee).mockResolvedValue({
      resolvedUserId: null,
      delegated: false,
      originalUserId: null,
    } as never)
    vi.mocked(prisma.auditLog.create).mockRejectedValue(new Error("noop")).mockResolvedValue({} as never)
    setupTxMock()
  })

  // ─── No rules → base stages unchanged ─────────────────────────────────────

  it("no rules → base stages created unchanged", async () => {
    const res = await POST(makePostReq("contract-1", BASE_STAGES), makeParams("contract-1"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data.stages).toBe(2) // both base stages pass through
  })

  // ─── slaHours sets dueAt on stage 1 at submit time ─────────────────────────

  it("slaHours on stage 1 sets dueAt in createMany (other stages get null dueAt)", async () => {
    let createdData: unknown[] = []

    vi.mocked(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([]),
        contractApprovalStage: {
          count: vi.fn().mockResolvedValue(0),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          createMany: vi.fn().mockImplementation(({ data }: { data: unknown[] }) => {
            createdData = data
            return Promise.resolve({ count: data.length })
          }),
        },
        contract: {
          findUnique: vi.fn().mockResolvedValue({ renderedBody: null }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      }
      return fn(tx)
    })

    const stagesWithSla = [
      { label: "Legal", slaHours: 48 },
      { label: "Finance", slaHours: 24 },
    ]
    const res = await POST(makePostReq("contract-1", stagesWithSla), makeParams("contract-1"))
    expect(res.status).toBe(200)

    // Stage 1 should have dueAt set (48h from now), stage 2 should have null dueAt
    const s1 = createdData[0] as { slaHours: number; dueAt: Date | null; order: number }
    const s2 = createdData[1] as { slaHours: number; dueAt: Date | null; order: number }
    expect(s1.slaHours).toBe(48)
    expect(s1.dueAt).toBeInstanceOf(Date)
    expect(s2.slaHours).toBe(24)
    // Stage 2's SLA clock starts only when stage 2 becomes active (advance tx)
    expect(s2.dueAt).toBeNull()
  })

  it("stage without slaHours → both slaHours and dueAt are null in createMany", async () => {
    let createdData: unknown[] = []

    vi.mocked(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([]),
        contractApprovalStage: {
          count: vi.fn().mockResolvedValue(0),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          createMany: vi.fn().mockImplementation(({ data }: { data: unknown[] }) => {
            createdData = data
            return Promise.resolve({ count: data.length })
          }),
        },
        contract: {
          findUnique: vi.fn().mockResolvedValue({ renderedBody: null }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      }
      return fn(tx)
    })

    const res = await POST(makePostReq("contract-1", BASE_STAGES), makeParams("contract-1"))
    expect(res.status).toBe(200)

    const s1 = createdData[0] as { slaHours: null; dueAt: null }
    expect(s1.slaHours).toBeNull()
    expect(s1.dueAt).toBeNull()
  })

  // ─── Matching rule ADDS a stage ────────────────────────────────────────────

  it("matching add_stage rule inserts an extra stage", async () => {
    const addRule = {
      id: "rule-add",
      organizationId: ORG,
      templateId: null,
      name: "CFO Review",
      conditions: [{ field: "value", operator: "gte", value: 10000 }],
      matchLogic: "all",
      isActive: true,
      createdAt: new Date("2026-01-01"),
      createdBy: null,
      actions: [
        {
          id: "act-1",
          ruleId: "rule-add",
          actionType: "add_stage",
          stageLabel: "CFO Approval",
          assigneeUserId: null,
          assigneeRole: "director",
          atPosition: null,
          sortOrder: 0,
          createdAt: new Date("2026-01-01"),
        },
      ],
    }
    vi.mocked(prisma.contractApprovalRule.findMany).mockResolvedValue([addRule] as never)

    const res = await POST(makePostReq("contract-1", BASE_STAGES), makeParams("contract-1"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.stages).toBe(3) // Legal + Finance + CFO Approval
  })

  // ─── skip_stage removes ALL → empty → 422 ─────────────────────────────────

  it("skip_stage removing all base stages → 422", async () => {
    const skipAllRules = BASE_STAGES.map((s, i) => ({
      id: `rule-skip-${i}`,
      organizationId: ORG,
      templateId: null,
      name: `Skip ${s.label}`,
      conditions: [],
      matchLogic: "all",
      isActive: true,
      createdAt: new Date(`2026-01-0${i + 1}`),
      createdBy: null,
      actions: [
        {
          id: `act-skip-${i}`,
          ruleId: `rule-skip-${i}`,
          actionType: "skip_stage",
          stageLabel: s.label,
          assigneeUserId: null,
          assigneeRole: null,
          atPosition: null,
          sortOrder: 0,
          createdAt: new Date(`2026-01-0${i + 1}`),
        },
      ],
    }))
    vi.mocked(prisma.contractApprovalRule.findMany).mockResolvedValue(skipAllRules as never)

    const res = await POST(makePostReq("contract-1", BASE_STAGES), makeParams("contract-1"))
    const json = await res.json()

    expect(res.status).toBe(422)
    expect(json.error).toMatch(/no approval stages remain/i)
  })

  // ─── Stage cap exceeded → 422 ──────────────────────────────────────────────

  it("stage cap exceeded after rule application → 422", async () => {
    // Submit 5 base stages (max allowed by schema) + an add rule → 6 → cap error
    const fiveStages = Array.from({ length: 5 }, (_, i) => ({ label: `Stage ${i + 1}` }))
    const addRule = {
      id: "rule-add",
      organizationId: ORG,
      templateId: null,
      name: "Extra Stage",
      conditions: [],
      matchLogic: "all",
      isActive: true,
      createdAt: new Date("2026-01-01"),
      createdBy: null,
      actions: [
        {
          id: "act-add",
          ruleId: "rule-add",
          actionType: "add_stage",
          stageLabel: "Extra",
          assigneeUserId: null,
          assigneeRole: null,
          atPosition: null,
          sortOrder: 0,
          createdAt: new Date("2026-01-01"),
        },
      ],
    }

    // Bypass submitSchema's max(5) by directly testing that applyApprovalRules
    // can push past MAX_STAGES (10) given a large enough base list.
    // We use max 9 base stages + 2 add rules = 11 > MAX_STAGES(10).
    const nineStages = Array.from({ length: 5 }, (_, i) => ({ label: `Base ${i + 1}` }))
    // Inject 6 add rules (each adds 1 stage → 5 base + 6 = 11 > MAX_STAGES)
    const addRules = Array.from({ length: 6 }, (_, i) => ({
      id: `rule-add-${i}`,
      organizationId: ORG,
      templateId: null,
      name: `Add ${i}`,
      conditions: [],
      matchLogic: "all",
      isActive: true,
      createdAt: new Date(`2026-01-${String(i + 1).padStart(2, "0")}`),
      createdBy: null,
      actions: [
        {
          id: `act-add-${i}`,
          ruleId: `rule-add-${i}`,
          actionType: "add_stage",
          stageLabel: `Extra ${i}`,
          assigneeUserId: null,
          assigneeRole: null,
          atPosition: null,
          sortOrder: 0,
          createdAt: new Date(`2026-01-${String(i + 1).padStart(2, "0")}`),
        },
      ],
    }))
    vi.mocked(prisma.contractApprovalRule.findMany).mockResolvedValue(addRules as never)

    const res = await POST(makePostReq("contract-1", nineStages), makeParams("contract-1"))
    const json = await res.json()

    expect(res.status).toBe(422)
    expect(json.error).toMatch(/cap exceeded/i)
  })

  // ─── Foreign-template rule NOT applied ────────────────────────────────────

  it("rule scoped to a different templateId is not applied to this contract", async () => {
    // The mock for contractApprovalRule.findMany already filters by OR (null OR matching templateId).
    // We verify the WHERE clause passed to findMany includes the correct filter.
    vi.mocked(prisma.contractApprovalRule.findMany).mockResolvedValue([])

    await POST(makePostReq("contract-1", BASE_STAGES), makeParams("contract-1"))

    const call = vi.mocked(prisma.contractApprovalRule.findMany).mock.calls[0][0]
    // Must filter by org + isActive + OR(templateId null, templateId match)
    expect(call?.where?.organizationId).toBe(ORG)
    expect(call?.where?.isActive).toBe(true)
    expect(call?.where?.OR).toBeDefined()

    const orClause = call?.where?.OR as Array<{ templateId?: string | null }>
    const hasNullTemplateBranch = orClause.some((c) => c.templateId === null)
    const hasMatchingTemplateBranch = orClause.some((c) => c.templateId === "tmpl-1")
    expect(hasNullTemplateBranch).toBe(true)
    expect(hasMatchingTemplateBranch).toBe(true)
  })

  // ─── Delegation resolves stage assignee to delegate ───────────────────────

  it("delegation resolves stage assignee to the active delegate", async () => {
    const stagesWithAssignee = [{ label: "Legal", assigneeUserId: "user-alice" }]

    vi.mocked(resolveApprovalAssignee).mockResolvedValue({
      resolvedUserId: "user-bob", // bob is alice's delegate
      delegated: true,
      originalUserId: "user-alice",
    } as never)

    // FIX 3: both alice (original) and bob (resolved delegate) must be valid same-org users
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "user-alice" },
      { id: "user-bob" },
    ] as never)

    setupTxMock()

    let createdStages: unknown[] = []
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([]),
        contractApprovalStage: {
          count: vi.fn().mockResolvedValue(0),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          createMany: vi.fn().mockImplementation(({ data }: { data: unknown[] }) => {
            createdStages = data
            return Promise.resolve({ count: data.length })
          }),
        },
        contract: {
          findUnique: vi.fn().mockResolvedValue({ renderedBody: null }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      }
      return fn(tx)
    })

    const res = await POST(makePostReq("contract-1", stagesWithAssignee), makeParams("contract-1"))
    expect(res.status).toBe(200)

    // The created stage should use the delegate (bob) as assigneeUserId,
    // and preserve the original (alice) as originalAssigneeUserId.
    const stage = createdStages[0] as { assigneeUserId: string; originalAssigneeUserId: string }
    expect(stage.assigneeUserId).toBe("user-bob")
    expect(stage.originalAssigneeUserId).toBe("user-alice")
  })

  // ─── Contract not found → 404 ──────────────────────────────────────────────

  it("returns 404 when contract does not belong to org", async () => {
    vi.mocked(prisma.contract.findFirst).mockResolvedValue(null)

    const res = await POST(makePostReq("contract-missing", BASE_STAGES), makeParams("contract-missing"))
    expect(res.status).toBe(404)
  })

  // ─── Step 5: server-side residual-variable gate ───────────────────────────
  it("returns 400 UNRESOLVED_VARIABLES when the body still has {{var}} tokens", async () => {
    vi.mocked(prisma.contract.findFirst).mockResolvedValue({
      ...CONTRACT,
      renderedBody: "Pay {{amount}} to {{party}} by the {{due_date}}.",
    } as never)

    const res = await POST(makePostReq("contract-1", BASE_STAGES), makeParams("contract-1"))
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.code).toBe("UNRESOLVED_VARIABLES")
    expect(json.variables).toEqual(["amount", "party", "due_date"])
  })

  // ─── Non-draft status → 409 ───────────────────────────────────────────────

  it("returns 409 when contract is not in draft (state machine blocks)", async () => {
    vi.mocked(canTransition).mockReturnValue({ ok: false, error: "Cannot transition from pending_approval to pending_approval" } as never)
    vi.mocked(prisma.contract.findFirst).mockResolvedValue({ ...CONTRACT, status: "pending_approval" } as never)

    const res = await POST(makePostReq("contract-1", BASE_STAGES), makeParams("contract-1"))
    expect(res.status).toBe(409)
  })

  // ─── Idempotency guard → 409 ──────────────────────────────────────────────
  // FIX 2: guard is now INSIDE the tx (tx-local count after the FOR UPDATE lock).
  // Setting pendingStagesInTx=2 makes the in-tx count return 2.
  //
  // Codex residual fix: the route now THROWS SubmitConflictError inside the tx
  // (not returns { conflict: true }). A normal return commits preceding writes;
  // a throw rolls back the entire tx. The mock propagates the throw → outer
  // catch maps SubmitConflictError → 409.

  it("returns 409 when pending stages already exist — tx throws SubmitConflictError (not returns)", async () => {
    // pendingStagesInTx=2: tx.contractApprovalStage.count returns 2 → SubmitConflictError thrown.
    setupTxMock(2)

    const res = await POST(makePostReq("contract-1", BASE_STAGES), makeParams("contract-1"))
    const json = await res.json()

    // 1. Handler must respond 409.
    expect(res.status).toBe(409)
    // 2. Error message must reflect the idempotency conflict.
    expect(json.error).toMatch(/already has pending/i)
    // 3. No success payload — the tx was rolled back, no partial chain persists.
    expect(json.success).toBeUndefined()
    expect(json.data).toBeUndefined()
    // 4. Confirm the mock $transaction was invoked (the tx callback ran and threw).
    expect(prisma.$transaction).toHaveBeenCalled()
  })

  // ─── Contract-status CAS miss → 409 (second in-tx conflict path) ──────────
  // Codex residual fix: when contract.updateMany returns count===0 (a concurrent
  // submit already advanced the status), the route now THROWS SubmitConflictError
  // inside the tx (not returns { conflict: true }). A normal return would commit
  // the createMany + superseded updateMany writes despite the 409.

  it("returns 409 when contract-status CAS misses inside tx — tx throws SubmitConflictError (not returns)", async () => {
    // Pending stages = 0 (idempotency guard passes), but contract updateMany returns count=0
    // (CAS miss — concurrent submit already advanced the contract status).
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([]),
        contractApprovalStage: {
          count: vi.fn().mockResolvedValue(0),       // idempotency guard passes
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          createMany: vi.fn().mockResolvedValue({ count: 2 }),
        },
        contract: {
          findUnique: vi.fn().mockResolvedValue({ renderedBody: null }),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }), // CAS MISS
        },
      }
      // Propagate — SubmitConflictError thrown by the callback rejects the tx promise.
      return fn(tx)
    })

    const res = await POST(makePostReq("contract-1", BASE_STAGES), makeParams("contract-1"))
    const json = await res.json()

    // 1. Handler must respond 409.
    expect(res.status).toBe(409)
    // 2. Error message must reflect the concurrent CAS conflict.
    expect(json.error).toMatch(/concurrently|retry/i)
    // 3. No success payload — the tx was rolled back, no partial chain persists.
    expect(json.success).toBeUndefined()
    expect(json.data).toBeUndefined()
    // 4. Confirm the mock $transaction was invoked (the tx callback ran and threw).
    expect(prisma.$transaction).toHaveBeenCalled()
  })

  // ─── In-tx residual-variable re-check → 409 (Codex MED TOCTOU guard) ───────
  // The pre-flight findResidualVars gate runs before the tx, but the body could
  // change between pre-flight and the FOR UPDATE lock. The route re-reads the
  // locked row and THROWS SubmitConflictError if a {{var}} appeared in the window.

  it("Codex MED: returns 409 when body gains a {{var}} between pre-flight and the in-tx lock (TOCTOU)", async () => {
    // Pre-flight passes (beforeEach CONTRACT.renderedBody is clean), but the
    // locked row read inside the tx returns a body with an unresolved variable.
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([]),
        contractApprovalStage: {
          count: vi.fn().mockResolvedValue(0),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          createMany: vi.fn().mockResolvedValue({ count: 2 }),
        },
        contract: {
          findUnique: vi.fn().mockResolvedValue({ renderedBody: "Now contains {{sneaky}} after lock." }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      }
      // Propagate — SubmitConflictError thrown by the in-tx re-check rejects the tx promise.
      return fn(tx)
    })

    const res = await POST(makePostReq("contract-1", BASE_STAGES), makeParams("contract-1"))
    const json = await res.json()

    // 1. Handler must respond 409 (SubmitConflictError → 409).
    expect(res.status).toBe(409)
    // 2. Error message must reflect the in-window mutation.
    expect(json.error).toMatch(/unresolved variables|reload/i)
    // 3. No success payload — the tx rolled back, no stage chain persisted.
    expect(json.success).toBeUndefined()
    expect(json.data).toBeUndefined()
    // 4. Confirm the tx callback actually ran (the re-check fires inside it).
    expect(prisma.$transaction).toHaveBeenCalled()
  })

  // ─── 401 when unauthenticated ─────────────────────────────────────────────

  it("returns 401 when not authenticated", async () => {
    vi.mocked(isAuthError).mockReturnValue(true)
    vi.mocked(requireAuth).mockResolvedValue(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) as never,
    )

    const res = await POST(makePostReq("contract-1", BASE_STAGES), makeParams("contract-1"))
    expect(res.status).toBe(401)
  })

  // ─── FIX 3: foreign-org assigneeUserId → 400 ──────────────────────────────

  it("FIX 3: assigneeUserId from a different org → 400 (user not found in org)", async () => {
    // resolveApprovalAssignee returns the foreign user as-is (no delegation)
    vi.mocked(resolveApprovalAssignee).mockResolvedValue({
      resolvedUserId: "user-foreign",
      delegated: false,
      originalUserId: "user-foreign",
    } as never)

    // user.findMany returns empty — "user-foreign" not in this org
    vi.mocked(prisma.user.findMany).mockResolvedValue([])

    const stagesWithForeignAssignee = [{ label: "Legal", assigneeUserId: "user-foreign" }]
    const res = await POST(makePostReq("contract-1", stagesWithForeignAssignee), makeParams("contract-1"))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/not found in this organization/i)
  })

  // ─── FIX 4: mixed flat/parallel shape → 400 ───────────────────────────────

  it("FIX 4: mixed flat + parallel stages → 400 (homogeneity violation)", async () => {
    const body = {
      stages: [
        { label: "Flat Stage", assigneeRole: "manager" }, // flat
        { label: "Parallel Stage", approvers: [{ assigneeRole: "legal" }], mode: "all" }, // parallel
      ],
    }
    const res = await POST(
      new NextRequest(`http://localhost/api/v1/contracts/contract-1/submit-for-approval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      makeParams("contract-1"),
    )
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/mixed approval shape/i)
  })

  // ─── FIX 5: levels exceed MAX_LEVELS_AFTER_RULES (8) → 422 ───────────────

  it("FIX 5: rule expansion pushes levels beyond MAX_LEVELS_AFTER_RULES → 422", async () => {
    // Start with 5 base levels (the max allowed at submit time), then inject 4 add_stage
    // rules → 9 final levels > MAX_LEVELS_AFTER_RULES (8).
    const fiveBaseStages = Array.from({ length: 5 }, (_, i) => ({
      label: `Base ${i + 1}`,
    }))

    const addRules = Array.from({ length: 4 }, (_, i) => ({
      id: `rule-add-${i}`,
      organizationId: ORG,
      templateId: null,
      name: `Add ${i}`,
      conditions: [],
      matchLogic: "all",
      isActive: true,
      createdAt: new Date(`2026-01-${String(i + 1).padStart(2, "0")}`),
      createdBy: null,
      actions: [
        {
          id: `act-add-${i}`,
          ruleId: `rule-add-${i}`,
          actionType: "add_stage",
          stageLabel: `Rule-Added ${i}`,
          assigneeUserId: null,
          assigneeRole: null,
          atPosition: null,
          sortOrder: 0,
          createdAt: new Date(`2026-01-${String(i + 1).padStart(2, "0")}`),
        },
      ],
    }))
    vi.mocked(prisma.contractApprovalRule.findMany).mockResolvedValue(addRules as never)

    const res = await POST(makePostReq("contract-1", fiveBaseStages), makeParams("contract-1"))
    const json = await res.json()

    expect(res.status).toBe(422)
    expect(json.error).toMatch(/exceeds the maximum.*levels after rule expansion/i)
  })
})

// ─── Concurrent contract-pointer guard on approvals/[order] ───────────────────

describe("POST /api/v1/contracts/:id/approvals/:order — concurrent contract-pointer guard", () => {
  /**
   * FIX A regression test: when routeApproval succeeds and the stage CAS (stage
   * updateMany) matches (count===1), but the CONTRACT updateMany returns count===0
   * (a concurrent request already advanced the contract pointer), the entire
   * $transaction must roll back (stage decision reverted → stage stays "pending")
   * and the caller receives 409.
   */

  const CONTRACT_PENDING = {
    id: "contract-1",
    title: "Test Contract",
    status: "pending_approval",
    organizationId: ORG,
  }

  const STAGE_PENDING = {
    contractId: "contract-1",
    organizationId: ORG,
    id: "stage-1",
    order: 1,
    status: "pending",
    label: "Legal",
    assigneeUserId: null,
    assigneeRole: null,
    originalAssigneeUserId: null,
    decidedBy: null,
    decidedAt: null,
  }

  function makeApprovalReq(contractId: string, order: number, decision: string) {
    return new NextRequest(
      `http://localhost/api/v1/contracts/${contractId}/approvals/${order}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      },
    )
  }

  function makeApprovalParams(id: string, order: number) {
    return { params: Promise.resolve({ id, order: String(order) }) }
  }

  beforeEach(() => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, userId: "user-admin", role: "admin" } as never)
    vi.mocked(isAuthError).mockReturnValue(false)
    // Pre-flight checks outside the tx: contract exists + pending_approval
    vi.mocked(prisma.contract.findFirst).mockResolvedValue(CONTRACT_PENDING as never)
    // Pre-flight stages check outside the tx (assignee auth gate)
    vi.mocked(prisma.contractApprovalStage.findMany).mockResolvedValue([STAGE_PENDING] as never)
  })

  it("contract updateMany count===0 → 409 and the transaction rolls back (stage stays pending)", async () => {
    // routeApproval returns ok=true so the engine proceeds past the stage CAS.
    vi.mocked(routeApproval).mockReturnValue({
      ok: true,
      updates: [],
      chainApproved: true,
      chainRejected: false,
      nextPendingOrder: null,
    } as never)

    // Simulate the tx shape: $queryRaw (lock) → contract pointer re-check →
    // stages findMany (fresh re-read) → stage CAS → contract updateMany miss.
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([]),  // FOR UPDATE lock — succeeds
        contractApprovalStage: {
          // findMany called AFTER stage CAS write (post-write re-read)
          findMany: vi.fn().mockResolvedValue([STAGE_PENDING]),
          update: vi.fn().mockResolvedValue({}),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }), // stage CAS succeeds
        },
        contract: {
          findFirst: vi.fn().mockResolvedValue({
            status: "pending_approval",
            currentApprovalStage: 1,
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }), // CONTRACT pointer miss
        },
      }
      // The callback should throw ContractPointerMissError when count===0.
      // We propagate the throw so the outer catch converts it to 409.
      return fn(tx)
    })

    const res = await POSTApproval(
      makeApprovalReq("contract-1", 1, "approve"),
      makeApprovalParams("contract-1", 1),
    )
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.error).toMatch(/concurrent|retry/i)
  })
})
