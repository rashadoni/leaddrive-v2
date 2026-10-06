import { describe, expect, it } from "vitest"
import { buildWorkforceTimesheetApproval } from "@/lib/workforce/timesheet-approval"
import type { WorkforceTimesheetCalculation } from "@/lib/workforce/timesheet-calculation"
import {
  reconcileWorkforceSnapshot, reconcileWorkforceSourceKind,
  type WorkforceReconciliationSnapshot,
} from "@/lib/workforce/reconciliation"

const calculation: WorkforceTimesheetCalculation = {
  calculationVersion: 1,
  policySnapshotId: "policy-snapshot",
  shiftSnapshotId: "shift-snapshot",
  status: "COMPLETED",
  isFinal: true,
  plan: {
    plannedStartAt: "2026-09-12T05:00:00.000Z",
    plannedEndAt: "2026-09-12T14:00:00.000Z",
    expectedWorkSeconds: 28_800,
    workDate: "2026-09-12",
    timezone: "Asia/Baku",
  },
  fact: {
    workdayId: "workday-1",
    startedAt: "2026-09-12T05:00:00.000Z",
    completedAt: "2026-09-12T14:00:00.000Z",
    workedSeconds: 28_800,
    pausedSeconds: 3_600,
    longestPauseSeconds: 3_600,
  },
  deviations: {
    lateStartSeconds: 0,
    undertimeSeconds: 0,
    overtimeSeconds: 0,
    longPauseSeconds: 0,
  },
  exceptions: [],
}

function coherentSnapshot(): WorkforceReconciliationSnapshot {
  const payload = buildWorkforceTimesheetApproval({
    periodStart: "2026-09-12",
    periodEnd: "2026-09-12",
    agentId: "agent-1",
    rows: [{
      workdayId: "workday-1",
      agentId: "agent-1",
      workDate: "2026-09-12",
      calculationVersion: 1,
      calculation,
    }],
  })
  return {
    workdays: [{ id: "workday-1", organizationId: "org-1", agentId: "agent-1" }],
    events: [{ id: "event-1", organizationId: "org-1", agentId: "agent-1", workdayId: "workday-1" }],
    transitions: [{ id: "transition-1", organizationId: "org-1", agentId: "agent-1", workdayId: "workday-1" }],
    evidence: [
      { id: "evidence-event", organizationId: "org-1", workdayEventId: "event-1", siteTransitionId: null },
      { id: "evidence-transition", organizationId: "org-1", workdayEventId: null, siteTransitionId: "transition-1" },
    ],
    assessments: [{ id: "assessment-1", organizationId: "org-1", evidenceId: "evidence-event" }],
    exceptions: [{
      id: "exception-1",
      organizationId: "org-1",
      agentId: "agent-1",
      workdayId: "workday-1",
      workdayEventId: "event-1",
      evidenceId: "evidence-event",
      segmentId: null,
      expectedWorkDate: null,
    }],
    approvals: [{
      id: "approval-1",
      organizationId: "org-1",
      agentId: "agent-1",
      periodStart: new Date("2026-09-12T00:00:00.000Z"),
      periodEnd: new Date("2026-09-12T00:00:00.000Z"),
      recordKind: "APPROVAL",
      revision: 1,
      supersedesId: null,
      calculationVersion: payload.calculationVersion,
      rowsHash: payload.rowsHash,
      factsHash: payload.factsHash,
      rows: payload.rows,
      approvedAt: new Date("2026-09-13T00:00:00.000Z"),
    }],
    exports: [{
      approvalId: "approval-1",
      organizationId: "org-1",
      agentId: "agent-1",
      approvalRowsHash: payload.rowsHash,
      approvalFactsHash: payload.factsHash,
    }],
  }
}


describe("independent root ownership parity",()=>{
  const kinds=["workdays","events","transitions","evidence","assessments","exceptions","approvals","exports"] as const
  function verify(snapshot:WorkforceReconciliationSnapshot){
    const full=reconcileWorkforceSnapshot(snapshot)
    const parts=kinds.map(kind=>reconcileWorkforceSourceKind(snapshot,kind))
    expect(parts.reduce((sum,p)=>sum+p.mismatchTotal,0)).toBe(full.mismatchTotal)
    const merged:Record<string,number>={}
    for(const part of parts)for(const [code,count]of Object.entries(part.mismatchCounts))merged[code]=(merged[code]??0)+(count??0)
    expect(merged).toEqual(full.mismatchCounts)
    for(const kind of kinds)expect(parts.reduce((sum,p)=>sum+p.examined[kind],0)).toBe(full.examined[kind])
    for(let i=0;i<kinds.length;i++)for(const kind of kinds)if(kind!==kinds[i])expect(parts[i].examined[kind]).toBe(0)
  }
  it("partitions coherent accounting without duplicating closure dependencies",()=>verify(coherentSnapshot()))
  it("partitions every mismatch family on simultaneously corrupt roots",()=>{
    const s=coherentSnapshot()
    s.events[0].workdayId="missing-day"
    s.transitions[0].agentId="wrong-agent"
    s.evidence.push({id:"no-subject",organizationId:"org-1",workdayEventId:null,siteTransitionId:null})
    s.evidence.push({id:"missing-subject",organizationId:"org-1",workdayEventId:"absent-event",siteTransitionId:null})
    s.assessments[0].evidenceId="missing-proof"
    s.exceptions.push({...s.exceptions[0],id:"empty-case",workdayId:null,workdayEventId:null,evidenceId:null})
    s.approvals[0].revision=2;s.approvals[0].rowsHash="0".repeat(64)
    s.exports[0].approvalFactsHash="1".repeat(64)
    verify(s)
    expect(reconcileWorkforceSnapshot(s).mismatchTotal).toBeGreaterThanOrEqual(9)
  })
  it("keeps invalid duplicate dependencies fatal even when their kind is not selected",()=>{
    const s=coherentSnapshot();s.events.push({...s.events[0]})
    expect(()=>reconcileWorkforceSourceKind(s,"exports")).toThrow(/^WORKFORCE_RECONCILIATION_DUPLICATE_ID:events$/)
  })
})
