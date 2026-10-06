import { Prisma } from "@prisma/client"
import { reconcileWorkforceSourceKind, type WorkforceReconciliationResult, type WorkforceReconciliationSnapshot } from "@/lib/workforce/reconciliation"
import { readWorkforceReconciliationApprovalGroup } from "@/lib/workforce/reconciliation-approval-group"
import { assertWorkforceReconciliationScheduleSubjects } from "@/lib/workforce/reconciliation-schedule-subject"
import { assertWorkforceExportAuditRecord, type WorkforceExportAuditRecord } from "@/lib/workforce/reconciliation-export-audit"
import type { WorkforceSweepTransaction } from "@/lib/workforce/reconciliation-snapshot"
import { readWorkforceSourceRows, sourceDate, validSourceId, type WorkforceSourceKind, type WorkforceSourceRow } from "@/lib/workforce/reconciliation-source-page"

const kinds: WorkforceSourceKind[] = ["workdays","events","transitions","evidence","assessments","exceptions","approvals","exports"]
const empty = (): Record<WorkforceSourceKind, WorkforceSourceRow[]> => ({ workdays:[],events:[],transitions:[],evidence:[],assessments:[],exceptions:[],approvals:[],exports:[] })
const ids = (rows: WorkforceSourceRow[], key: string) => [...new Set(rows.flatMap(row => typeof row[key] === "string" ? [row[key] as string] : []))]
const overflow = () => new Error("WORKFORCE_DENSE_COMPONENT_OVERFLOW")

async function closeRoots(tx: WorkforceSweepTransaction, organizationId: string, kind: WorkforceSourceKind, roots: WorkforceSourceRow[]): Promise<WorkforceReconciliationSnapshot> {
  const raw = empty(); raw[kind] = roots
  async function add(target: WorkforceSourceKind, wanted: string[]) {
    const existing = new Set(ids(raw[target],"id"))
    const missing = wanted.filter(id => !existing.has(id))
    if (missing.length) raw[target].push(...await readWorkforceSourceRows(tx,organizationId,target,{ ids:missing,limit:1000 }))
  }
  await add("evidence",[...new Set([...ids(raw.assessments,"evidenceId"),...ids(raw.exceptions,"evidenceId")])])
  await add("events",[...new Set([...ids(raw.evidence,"workdayEventId"),...ids(raw.exceptions,"workdayEventId")])])
  await add("transitions",ids(raw.evidence,"siteTransitionId"))
  await add("workdays",[...new Set([...ids(raw.events,"workdayId"),...ids(raw.transitions,"workdayId"),...ids(raw.exceptions,"workdayId")])])
  const exports: WorkforceReconciliationSnapshot["exports"][number][] = []
  if (kind === "exports") {
    const audits = roots.map(row => {
      const audit = row as unknown as WorkforceExportAuditRecord
      assertWorkforceExportAuditRecord(audit)
      return audit
    })
    await add("approvals",[...new Set(audits.map(row => row.data.approvalId))])
    for (const audit of audits) {
      const approval = raw.approvals.find(row => row.id === audit.data.approvalId)
      if (!approval || approval.agentId !== audit.agentId || approval.revision !== audit.data.revision || approval.recordKind !== audit.data.recordKind
        || (approval.periodStart as Date).toISOString().slice(0,10) !== audit.data.periodStart
        || (approval.periodEnd as Date).toISOString().slice(0,10) !== audit.data.periodEnd) throw new Error("WORKFORCE_DENSE_AUDIT_REFERENCE_INVALID")
      exports.push({ approvalId:audit.data.approvalId,organizationId,agentId:audit.agentId,approvalRowsHash:audit.data.rowsHash,approvalFactsHash:audit.data.factsHash })
    }
  }
  const complete = { ...raw,exports } as unknown as WorkforceReconciliationSnapshot
  if (Object.values(complete).some(rows => rows.length > 1000) || Buffer.byteLength(JSON.stringify(complete),"utf8") > 4_194_304) throw overflow()
  await assertWorkforceReconciliationScheduleSubjects(tx,organizationId,complete)
  return complete
}

type Group = { agentId:string; start:string; end:string; rootId:string }
async function approvalGroups(tx: WorkforceSweepTransaction, organizationId:string, after:Group|null):Promise<Group[]> {
  let result:Array<{ groups:Group[]|null; context:boolean }>
  try {
    result = await tx.$queryRaw<typeof result>(Prisma.sql`
      WITH selected AS MATERIALIZED (
        SELECT "agentId" COLLATE "C" AS "agentId",to_char("periodStart",'YYYY-MM-DD') AS start,to_char("periodEnd",'YYYY-MM-DD') AS "end",min(id COLLATE "C") AS "rootId"
        FROM workforce_timesheet_approvals WHERE "organizationId"=${organizationId}
        ${after === null ? Prisma.empty : Prisma.sql`AND ("agentId" COLLATE "C","periodStart","periodEnd") > (${after.agentId}::text COLLATE "C",${after.start}::date,${after.end}::date)`}
        GROUP BY "agentId" COLLATE "C","periodStart","periodEnd"
        ORDER BY "agentId" COLLATE "C","periodStart","periodEnd" LIMIT 128
      ), budget AS (SELECT COALESCE(sum(octet_length(to_jsonb(selected)::text)),0) AS bytes FROM selected)
      SELECT (current_setting('transaction_read_only')='on' AND current_setting('transaction_isolation') IN ('repeatable read','serializable')) AS context,
        CASE WHEN bytes <= 1048576 THEN COALESCE((SELECT jsonb_agg(to_jsonb(selected) ORDER BY "agentId" COLLATE "C",start,"end") FROM selected),'[]'::jsonb) ELSE NULL END AS groups FROM budget
    `)
  } catch { throw new Error("WORKFORCE_DENSE_READ_FAILED") }
  if (result.length!==1 || !result[0].context) throw new Error("WORKFORCE_DENSE_CONTEXT_REQUIRED")
  const groups=result[0].groups
  if (!groups) throw overflow()
  for (const row of groups) {
    if (!validSourceId(row.agentId)||!validSourceId(row.rootId)) throw new Error("WORKFORCE_DENSE_SOURCE_INVALID")
    sourceDate(row.start);sourceDate(row.end)
  }
  return groups
}

/**
 * Bounded-memory dense tenant sweep. Every root kind and complete approval group
 * is enumerated once in ONE authorized MVCC transaction. No persisted row cursor.
 * <=100000 roots total; <=1000 rows/1MiB per atomic approval group; adaptive root
 * pages and <=4MiB dependency components. Overflow/timeouts refuse all progress.
 */
export async function reconcileWorkforceDenseSnapshot(tx:WorkforceSweepTransaction,organizationId:string):Promise<WorkforceReconciliationResult> {
  if (!validSourceId(organizationId)) throw new Error("WORKFORCE_DENSE_INPUT_INVALID")
  if ("$transaction" in tx) throw new Error("WORKFORCE_DENSE_CONTEXT_REQUIRED")
  const result:WorkforceReconciliationResult={status:"MATCHED",examined:{workdays:0,events:0,transitions:0,evidence:0,assessments:0,exceptions:0,approvals:0,exports:0},mismatchCounts:{},mismatchTotal:0,repair:"NONE"}
  const examined={...result.examined}
  function accumulate(part:WorkforceReconciliationResult) {
    for (const kind of kinds) examined[kind]+=part.examined[kind]
    if (Object.values(examined).reduce((a,b)=>a+b,0)>100_000) throw new Error("WORKFORCE_DENSE_SWEEP_OVERFLOW")
    for (const [code,count] of Object.entries(part.mismatchCounts)) {
      const key=code as keyof typeof result.mismatchCounts
      result.mismatchCounts[key]=(result.mismatchCounts[key]??0)+(count??0)
    }
    result.mismatchTotal+=part.mismatchTotal
  }
  for (const kind of kinds) {
    if (kind === "approvals") {
      let after:Group|null=null
      for (;;) {
        const groups=await approvalGroups(tx,organizationId,after)
        for (const group of groups) {
          const approvals=await readWorkforceReconciliationApprovalGroup(tx,{organizationId,agentId:group.agentId,rootApprovalId:group.rootId,periodStart:new Date(`${group.start}T00:00:00.000Z`),periodEnd:new Date(`${group.end}T00:00:00.000Z`)})
          accumulate(reconcileWorkforceSourceKind({...empty(),approvals} as unknown as WorkforceReconciliationSnapshot,"approvals"))
        }
        if (groups.length<128) break
        after=groups.at(-1)!
      }
      continue
    }
    let after:string|null=null
    for (;;) {
      let limit=kind === "exceptions" ? 64 : 128
      let roots:WorkforceSourceRow[]
      let part:WorkforceReconciliationResult
      for (;;) {
        try {
          roots=await readWorkforceSourceRows(tx,organizationId,kind,{after,limit})
          part=reconcileWorkforceSourceKind(await closeRoots(tx,organizationId,kind,roots),kind)
          break
        } catch(error) {
          if (error instanceof Error && ["WORKFORCE_DENSE_PAGE_OVERFLOW","WORKFORCE_DENSE_COMPONENT_OVERFLOW"].includes(error.message) && limit>1) { limit=Math.max(1,Math.floor(limit/2));continue }
          throw error
        }
      }
      accumulate(part)
      if (roots.length<limit) break
      after=roots.at(-1)!.id as string
    }
  }
  return {...result,examined,status:result.mismatchTotal ? "MISMATCH" : "MATCHED"}
}
