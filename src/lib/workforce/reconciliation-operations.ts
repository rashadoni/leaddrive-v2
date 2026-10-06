import { randomUUID } from "node:crypto"
import type { Prisma, PrismaClient } from "@prisma/client"
import { isTenantCapabilityEnabled } from "@/lib/tenant-capabilities"
import { runWorkforceReconciliationSweep } from "@/lib/workforce/reconciliation-sweep"
import { workforceReconciliationCursorStore } from "@/lib/workforce/reconciliation-cursor-store"

const JOB="workforce-claim-reconciliation-v1"
type Control=Pick<PrismaClient,"$transaction"|"$queryRaw">
type Tx=Prisma.TransactionClient
type Outcome="MATCHED"|"MISMATCH"|"INCOMPLETE"|"FENCED_OUT"|"VERSION_EXHAUSTED"|"UNKNOWN"
type Claim={organizationId:string;attemptToken:string}
const validId=(value:unknown):value is string=>typeof value==="string"&&value.trim().length>0&&value.length<=191
const refused=()=>new Error("WORKFORCE_RECONCILIATION_OPERATIONS_UNAVAILABLE")

async function fence(tx:Tx,ownerToken:string):Promise<boolean> {
  await tx.$queryRaw`SELECT name FROM system_job_leases WHERE name=${JOB} FOR UPDATE`
  // Separate statement evaluates wall clock AFTER any lock wait.
  const rows=await tx.$queryRaw<Array<{valid:boolean}>>`SELECT true AS valid FROM system_job_leases
    WHERE name=${JOB} AND "ownerToken"=${ownerToken} AND status='running' AND "leaseUntil">clock_timestamp()`
  return rows.length===1
}

/** Supplied control client must already be authorized for cross-tenant operations. */
export function workforceReconciliationOperationsStore(db:Control) {
  return {
    async claim(ownerToken:string):Promise<{status:"CLAIMED";claim:Claim;eligible:number}|{status:"IDLE"|"FENCED_OUT";eligible:number}> {
      if (!validId(ownerToken)) throw refused()
      try {
        return await db.$transaction(async tx=>{
          if (!await fence(tx,ownerToken)) return {status:"FENCED_OUT" as const,eligible:0}
          const result=await tx.$queryRaw<Array<{count:number;records:Array<{id:string;plan:string;addons:unknown;features:unknown;modules:unknown;due:boolean}>|null}>>`
            WITH roots AS MATERIALIZED (
              SELECT o.id,jsonb_build_object('id',o.id,'plan',o.plan,'addons',o.addons,'features',o.features,'modules',o.modules,
                'due',COALESCE(s."dueAt",o."createdAt")<=clock_timestamp()) AS value,
                COALESCE(s."dueAt",o."createdAt") AS due_at,COALESCE(s."lastAttemptAt",o."createdAt") AS attempted_at
              FROM organizations o LEFT JOIN workforce_reconciliation_tenant_states s ON s."organizationId"=o.id
              WHERE o."isActive" ORDER BY due_at,attempted_at,o.id COLLATE "C" LIMIT 10001
            ), budget AS (SELECT count(*)::integer AS count,COALESCE(sum(octet_length(value::text)),0) AS bytes FROM roots)
            SELECT count,CASE WHEN count<=10000 AND bytes<=4194304 THEN COALESCE((SELECT jsonb_agg(value ORDER BY due_at,attempted_at,id COLLATE "C") FROM roots),'[]'::jsonb) ELSE NULL END AS records FROM budget
          `
          if (result.length!==1 || !result[0].records || result[0].count!==result[0].records.length) throw refused()
          const eligible=result[0].records.filter(row=>{
            if (!validId(row.id)) throw refused()
            try { return isTenantCapabilityEnabled("workforce-hrm",row) } catch { return false }
          })
          const selected=eligible.find(row=>row.due)
          if (!selected) return {status:"IDLE" as const,eligible:eligible.length}
          await tx.$queryRaw`SELECT "organizationId" FROM workforce_reconciliation_tenant_states WHERE "organizationId"=${selected.id} FOR UPDATE`
          const attemptToken=randomUUID()
          // Claim records an ATTEMPT, not a matched sweep. Crash retry becomes due
          // after two minutes and does not pin the queue to this tenant.
          const written=await tx.$queryRaw<Array<{id:string}>>`
            INSERT INTO workforce_reconciliation_tenant_states ("organizationId","attemptToken","lastAttemptAt","dueAt","lastOutcome","updatedAt")
            SELECT ${selected.id},${attemptToken}::uuid,clock_timestamp(),clock_timestamp()+interval '2 minutes','RUNNING',clock_timestamp()
            WHERE EXISTS (SELECT 1 FROM system_job_leases WHERE name=${JOB} AND "ownerToken"=${ownerToken} AND status='running' AND "leaseUntil">clock_timestamp())
            ON CONFLICT ("organizationId") DO UPDATE SET "attemptToken"=EXCLUDED."attemptToken","lastAttemptAt"=EXCLUDED."lastAttemptAt",
              "dueAt"=EXCLUDED."dueAt","lastOutcome"='RUNNING',"updatedAt"=EXCLUDED."updatedAt"
            WHERE EXISTS (SELECT 1 FROM system_job_leases WHERE name=${JOB} AND "ownerToken"=${ownerToken} AND status='running' AND "leaseUntil">clock_timestamp())
            RETURNING "organizationId" AS id
          `
          if (written.length!==1) return {status:"FENCED_OUT" as const,eligible:eligible.length}
          if (!await fence(tx,ownerToken)) throw new Error("WORKFORCE_RECONCILIATION_CLAIM_EXPIRED")
          return {status:"CLAIMED" as const,claim:{organizationId:selected.id,attemptToken},eligible:eligible.length}
        },{timeout:10000})
      } catch(error) {
        if (error instanceof Error && error.message === "WORKFORCE_RECONCILIATION_CLAIM_EXPIRED") return {status:"FENCED_OUT" as const,eligible:0}
        throw refused()
      }
    },
    async finish(ownerToken:string,claim:Claim,result:{outcome:Outcome;examined:number;mismatches:number;durationMs:number}):Promise<boolean> {
      if (!validId(ownerToken)||!validId(claim.organizationId)||!/^[a-f0-9-]{36}$/.test(claim.attemptToken)
        || !["MATCHED","MISMATCH","INCOMPLETE","FENCED_OUT","VERSION_EXHAUSTED","UNKNOWN"].includes(result.outcome)
        || !Number.isInteger(result.examined)||result.examined<0||result.examined>100000
        || !Number.isInteger(result.mismatches)||result.mismatches<0||result.mismatches>1000000
        || (result.outcome==="MATCHED" && result.mismatches!==0) || (result.outcome==="MISMATCH" && result.mismatches===0)
        || !Number.isInteger(result.durationMs)||result.durationMs<0||result.durationMs>3600000) throw refused()
      const {organizationId,attemptToken}=claim;const {outcome,examined,mismatches,durationMs}=result
      try {
        return await db.$transaction(async tx=>{
          if (!await fence(tx,ownerToken)) return false
          // Finish any row-lock wait before checking expiry in the later update.
          await tx.$queryRaw`SELECT "organizationId" FROM workforce_reconciliation_tenant_states WHERE "organizationId"=${organizationId} FOR UPDATE`
          const rows=await tx.$queryRaw<Array<{id:string}>>`
            UPDATE workforce_reconciliation_tenant_states SET "attemptToken"=NULL,"lastOutcome"=${outcome},
              "lastCompletedAt"=CASE WHEN ${outcome}='MATCHED' THEN clock_timestamp() ELSE "lastCompletedAt" END,
              "consecutiveFailures"=CASE WHEN ${outcome}='MATCHED' THEN 0 ELSE LEAST(1000,"consecutiveFailures"+1) END,
              "dueAt"=clock_timestamp()+(CASE WHEN ${outcome}='MATCHED' THEN 3600 ELSE LEAST(1800,30*power(2,LEAST(6,"consecutiveFailures"))) END)*interval '1 second',
              "examinedCount"=${examined},"mismatchCount"=${mismatches},"durationMs"=${durationMs},"updatedAt"=clock_timestamp()
            WHERE "organizationId"=${organizationId} AND "attemptToken"=${attemptToken}::uuid AND "lastOutcome"='RUNNING' AND "dueAt">clock_timestamp()
              AND EXISTS (SELECT 1 FROM system_job_leases WHERE name=${JOB} AND "ownerToken"=${ownerToken} AND status='running' AND "leaseUntil">clock_timestamp())
            RETURNING "organizationId" AS id
          `
          return rows.length===1
        },{timeout:10000})
      } catch { throw refused() }
    },
    async health() {
      try {
        const rows=await db.$queryRaw<Array<{tracked:number;running:number;failed:number;due:number;neverCompleted:number;stale:number}>>`
          SELECT count(*)::integer AS tracked,count(*) FILTER(WHERE "lastOutcome"='RUNNING')::integer AS running,
            count(*) FILTER(WHERE "lastOutcome" IN ('MISMATCH','INCOMPLETE','FENCED_OUT','VERSION_EXHAUSTED','UNKNOWN'))::integer AS failed,
            count(*) FILTER(WHERE "dueAt"<=clock_timestamp())::integer AS due,
            count(*) FILTER(WHERE "lastCompletedAt" IS NULL)::integer AS "neverCompleted",
            count(*) FILTER(WHERE ("lastOutcome"='RUNNING' AND "lastAttemptAt"<clock_timestamp()-interval '2 minutes')
              OR ("lastCompletedAt" IS NOT NULL AND "lastCompletedAt"<clock_timestamp()-interval '2 hours'))::integer AS stale
          FROM workforce_reconciliation_tenant_states
        `
        if (rows.length!==1) throw refused()
        const row=rows[0]
        return {...row,coverage:"TRACKED_ATTEMPTS_ONLY" as const,eligibleRosterCoverage:"NOT_MEASURED" as const,alerts:[...(row.failed?["RECONCILIATION_FAILURE"]:[]),...(row.stale?["RECONCILIATION_STALE"]:[]),...(row.neverCompleted?["RECONCILIATION_NEVER_COMPLETED"]:[])]}
      } catch { throw refused() }
    },
  }
}

/** One dormant tick. Caller owns lease acquisition and scoped read authorization. */
export async function runWorkforceReconciliationTick(input:{
  control:Control;ownerToken:string;readerForOrganization:(organizationId:string)=>Promise<Pick<PrismaClient,"$transaction">>
}) {
  const store=workforceReconciliationOperationsStore(input.control)
  const selected=await store.claim(input.ownerToken)
  if (selected.status!=="CLAIMED") return {status:selected.status,eligible:selected.eligible}
  const started=Date.now();let outcome:Outcome="INCOMPLETE";let examined=0;let mismatches=0
  try {
    const reader=await input.readerForOrganization(selected.claim.organizationId)
    const result=await runWorkforceReconciliationSweep({reader,cursor:workforceReconciliationCursorStore(input.control,selected.claim),organizationId:selected.claim.organizationId,ownerToken:input.ownerToken,dense:true,authorizeSnapshot:async tx=>{
      const context=await tx.$queryRaw<Array<{valid:boolean}>>`SELECT
        (current_setting('app.org_id',true)=${selected.claim.organizationId} AND current_setting('app.rls_bypass',true)='off'
          AND NOT rolsuper AND NOT rolbypassrls) AS valid FROM pg_roles WHERE rolname=current_user`
      if (context.length!==1 || context[0].valid!==true) throw refused()
      const rows=await tx.$queryRaw<Array<{value:{isActive:boolean;plan:string;addons:unknown;features:unknown;modules:unknown}|null}>>`
        WITH selected AS MATERIALIZED (SELECT jsonb_build_object('isActive',"isActive",'plan',plan,'addons',addons,'features',features,'modules',modules) AS value
          FROM organizations WHERE id=${selected.claim.organizationId})
        SELECT CASE WHEN octet_length(value::text)<=65536 THEN value ELSE NULL END AS value FROM selected
      `
      const value=rows[0]?.value
      if (rows.length!==1 || !value?.isActive || !isTenantCapabilityEnabled("workforce-hrm",value)) throw refused()
    }})
    outcome=result.status;examined=Object.values(result.examined).reduce((a,b)=>a+b,0);mismatches=result.mismatchTotal
  } catch(error) {
    outcome=error instanceof Error&&error.message==="WORKFORCE_SWEEP_CHECKPOINT_OUTCOME_UNKNOWN"?"UNKNOWN":"INCOMPLETE"
  }
  const recorded=await store.finish(input.ownerToken,selected.claim,{outcome,examined,mismatches,durationMs:Math.min(3600000,Math.max(0,Date.now()-started))})
  return {status:recorded?outcome:"FENCED_OUT",eligible:selected.eligible,examined,mismatches,attemptRecorded:recorded}
}
