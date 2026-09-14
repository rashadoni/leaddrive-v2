import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { MtmSignatureEvidence, VisitActionResultSchema, VisitPolicyCreateSchema } from "@/lib/mtm-validators"
import { MTM_VISIT_ACTION_KEYS } from "@/lib/mtm/visit-policies"
import { canManageMtmVisitPolicies } from "@/lib/mtm/route-permissions"

/**
 * Customer signature on the tablet (owner request 2026-09-14): optional by
 * default, and managers and above decide per visit policy whether it is
 * hidden, optional or required.
 */
const signature = { method: "drawn", svgPath: "M10 20 L30 40 Q50 60 70 40", widthPx: 600, heightPx: 240 }

describe("signature as a visit action", () => {
  it("is a policy action like the others, optional unless a policy says otherwise", () => {
    expect(MTM_VISIT_ACTION_KEYS).toContain("SIGNATURE")
    const migration = readFileSync(join(process.cwd(), "prisma/migrations/20260914150000_mtm_visit_action_signature/migration.sql"), "utf8")
    expect(migration).toContain(`ALTER TYPE "MtmVisitActionKey" ADD VALUE IF NOT EXISTS 'SIGNATURE'`)
  })

  it("lets a policy configure all eight actions", () => {
    const parsed = VisitPolicyCreateSchema.safeParse({
      name: "All actions",
      effectiveFrom: "2026-09-14T00:00:00.000Z",
      actions: MTM_VISIT_ACTION_KEYS.map((actionKey) => ({ actionKey, mode: actionKey === "SIGNATURE" ? "REQUIRED" : "OPTIONAL" })),
    })
    expect(parsed.success).toBe(true)
  })

  it("accepts a drawn path and refuses anything else as a completed signature", () => {
    expect(VisitActionResultSchema.safeParse({ actionKey: "SIGNATURE", evidence: signature }).success).toBe(true)
    expect(VisitActionResultSchema.safeParse({ actionKey: "SIGNATURE" }).success).toBe(false)
    expect(VisitActionResultSchema.safeParse({ actionKey: "SIGNATURE", evidence: { ...signature, svgPath: "M1 1<script>" } }).success).toBe(false)
    expect(MtmSignatureEvidence.safeParse({ ...signature, widthPx: 10 }).success).toBe(false)
  })
})

describe("who may configure visit policies", () => {
  const prisma = { mtmAgent: { findFirst: vi.fn() } }

  it("allows web admins and managers without an agent lookup", async () => {
    for (const webRole of ["superadmin", "admin", "manager"]) {
      expect(await canManageMtmVisitPolicies(prisma as never, { organizationId: "org-1", userId: "u", webRole })).toBe(true)
    }
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
  })

  it("refuses a web user who is not a manager when no manager agent stands behind them", async () => {
    prisma.mtmAgent.findFirst.mockResolvedValue(null)
    expect(await canManageMtmVisitPolicies(prisma as never, { organizationId: "org-1", userId: "u", webRole: "user" })).toBe(false)
  })
})
