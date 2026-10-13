import { z } from "zod"

const identifier = z.string().uuid()
const operation = { requestId: identifier, expectedRevisionId: identifier.nullable() }
export const AttendanceBranchInputSchema = z.object({ ...operation, branchId: identifier.nullable(),
  name: z.string().trim().min(1).max(160), address: z.string().trim().min(1).max(500),
  latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180),
  radiusMeters: z.number().int().min(25).max(5000), active: z.boolean(),
}).strict().refine(value => (value.branchId === null) === (value.expectedRevisionId === null), { path: ["expectedRevisionId"] })
export const AttendanceBranchAssignmentInputSchema = z.object({ ...operation,
  agentId: z.string().trim().min(1).max(100), branchId: identifier.nullable(),
}).strict()
export type AttendanceBranchInput = z.infer<typeof AttendanceBranchInputSchema>
export type AttendanceBranchAssignmentInput = z.infer<typeof AttendanceBranchAssignmentInputSchema>
/** Revision IDs are immutable references for later START/FINISH evidence. */
export type AttendanceBranch = {
  id: string; revisionId: string; version: number; name: string; address: string;
  latitude: number; longitude: number; radiusMeters: number; active: boolean; createdAt: string
}
export type AttendancePrimaryBranch = { revisionId: string; version: number; branchId: string | null; createdAt: string }
export type AttendanceBranchEmployee = { id: string; name: string; teamName: string | null; canAssign: boolean; primary: AttendancePrimaryBranch | null }
export type AttendanceBranchDirectory = { branches: AttendanceBranch[]; canManageBranches: boolean }
export type AttendanceBranchAssignments = { employees: AttendanceBranchEmployee[]; hasMore: boolean }
