import { randomUUID } from "node:crypto"
import { ATTENDANCE_TRACKED_CARD_WHERE } from "@/lib/mtm/attendance-tracking"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { currentAttendanceReadActor } from "@/lib/mtm/attendance-read-access"
import { resolveAttendanceReviewerScope, type AttendanceReviewer } from "@/lib/mtm/attendance-request-decision"
import { AttendanceCorrectionBasisSchema, AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { lockAttendanceRequests } from "@/lib/mtm/attendance-self-access"
import { lockMtmWorkdayTransitions } from "@/lib/mtm/workday"
import { readAttendanceProjectionInTransaction } from "@/lib/mtm/attendance-report-store"
import { AttendanceMonthCloseSchema, AttendanceMonthQuerySchema, AttendanceMonthSelectionSchema, type AttendanceMonthDirectory, type AttendanceMonthDetail, type AttendanceMonthSelection, type AttendanceMonthSummary } from "@/lib/mtm/attendance-month-contract"
import { attendanceMonthHash, attendanceMonthRange, buildAttendanceMonthSnapshot, verifiedAttendanceMonthSnapshot } from "@/lib/mtm/attendance-month-snapshot"
import type { AttendanceTable } from "@/lib/mtm/attendance-table"
type Tx=Prisma.TransactionClient
type Row={id:string;month:Date;createdAt:Date;createdByName:string|null;createdBy:string;requestHash:string;payloadHash:string;payload:unknown}
const fail=(code:string,status=409):never=>{throw new AttendanceRequestError(`MTM_ATTENDANCE_MONTH_${code}`,status)}
const summary=(row:Row,count:number):AttendanceMonthSummary=>({id:row.id,month:row.month.toISOString().slice(0,7),createdAt:row.createdAt.toISOString(),createdByName:row.createdByName,employeeCount:count})
const uuid=(id:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
async function writeScope(tx:Tx, reviewer:AttendanceReviewer, ids:readonly string[]) {
  await currentAttendanceReadActor(tx,reviewer)
  const actor=await resolveAttendanceReviewerScope(tx,reviewer)
  if(actor.scopedAgentIds!==null && ids.some(id=>!actor.scopedAgentIds!.includes(id))) return fail("FORBIDDEN",403)
  const targets=await tx.mtmAgent.findMany({where:{organizationId:reviewer.organizationId,id:{in:[...ids]},...ATTENDANCE_TRACKED_CARD_WHERE},select:{id:true,userId:true}})
  if(targets.length!==ids.length || targets.some(row=>row.userId===reviewer.userId)) return fail("FORBIDDEN",403)
}
async function snapshot(tx:Tx, reviewer:AttendanceReviewer, selection:AttendanceMonthSelection, asOf:Date) {
  const range=attendanceMonthRange(selection.month)
  const report=await readAttendanceProjectionInTransaction(tx,{organizationId:reviewer.organizationId,authorizedEmployeeIds:selection.agentIds,query:{...range,form:"ALL"},now:asOf})
  try{return buildAttendanceMonthSnapshot(report,selection,new Date())}catch(error){if(error instanceof Error && error.message.startsWith("MTM_ATTENDANCE_MONTH_"))throw new AttendanceRequestError(error.message,409);throw error}
}
export async function previewAttendanceMonth(reviewer:AttendanceReviewer,raw:unknown,locale:"az"|"ru"|"en") {
  const parsed=AttendanceMonthSelectionSchema.safeParse(raw);if(!parsed.success)return fail("INVALID",400)
  return prisma.$transaction(async tx=>{await writeScope(tx,reviewer,parsed.data.agentIds);const value=await snapshot(tx,reviewer,parsed.data,new Date());return {month:parsed.data.month,agentIds:value.payload.agentIds,hash:value.hash,asOf:value.payload.asOf,table:value.payload.tables[locale] as AttendanceTable,blockers:value.blockers}}, {isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:15000})
}
export async function closeAttendanceMonth(reviewer:AttendanceReviewer,raw:unknown) {
  const parsed=AttendanceMonthCloseSchema.safeParse(raw);if(!parsed.success)return fail("INVALID",400)
  const input=parsed.data,ids=[...input.agentIds].sort(),org=reviewer.organizationId
  const hash=attendanceMonthHash({...input,agentIds:ids,actor:reviewer.userId})
  return prisma.$transaction(async tx=>{
    await tx.$executeRaw`SELECT set_config('lock_timeout','3s',true)`
    // Canonical writers take employee locks before the source-fence trigger.
    // Match that order, sort a multi-employee close, then lock current auth rows.
    for(const agentId of ids){await lockMtmWorkdayTransitions(tx,{organizationId:org,agentId});await lockAttendanceRequests(tx,{organizationId:org,agentId})}
    await writeScope(tx,reviewer,ids)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-attendance-month-snapshot:${org}`},0))`
    // Scope sources are now fenced too; check after waiting for the fence.
    await writeScope(tx,reviewer,ids)
    const [receipt]=await tx.$queryRaw<Row[]>`SELECT * FROM mtm_attendance_month_closes WHERE "organizationId"=${org} AND "requestId"=${input.requestId}`
    if(receipt){if(receipt.requestHash!==hash || receipt.createdBy!==reviewer.userId)return fail("REPLAY_MISMATCH");const payload=verifiedAttendanceMonthSnapshot(receipt.payload,receipt.payloadHash);return {...summary(receipt,payload.agentIds.length),idempotent:true}}
    if(Date.parse(input.preview.asOf)>Date.now()+60000 || Date.parse(input.preview.asOf)<Date.now()-30*60000)return fail("PREVIEW_EXPIRED")
    const prior=await tx.$queryRaw<{id:string}[]>`SELECT id FROM mtm_attendance_month_members WHERE "organizationId"=${org} AND "agentId"=ANY(${ids}::text[]) AND month=${new Date(`${input.month}-01T00:00:00Z`)}::date LIMIT 1`
    if(prior.length)return fail("ALREADY_CLOSED")
    const value=await snapshot(tx,reviewer,{month:input.month,agentIds:ids},new Date(input.preview.asOf))
    if(value.hash!==input.preview.hash)return fail("CHANGED")
    if(value.blockers.length)return fail("UNRESOLVED")
    const dates=[...new Map(value.payload.coverage.map(row=>[`${row.agentId}:${row.sourceDate}`,row])).values()]
    const overlap=await tx.$queryRaw<{id:string}[]>(Prisma.sql`SELECT id FROM mtm_attendance_month_days WHERE "organizationId"=${org} AND (${Prisma.join(dates.map(day=>Prisma.sql`("agentId"=${day.agentId} AND "sourceDate"=${new Date(`${day.sourceDate}T00:00:00Z`)}::date)`),' OR ')}) LIMIT 1`)
    if(overlap.length)return fail("SOURCE_CLOSED")
    const actor=await tx.user.findFirst({where:{organizationId:org,id:reviewer.userId},select:{name:true}}),id=randomUUID(),month=new Date(`${input.month}-01T00:00:00Z`)
    const [created]=await tx.$queryRaw<Row[]>`INSERT INTO mtm_attendance_month_closes(id,"organizationId",month,"requestId","requestHash","payloadHash",payload,"createdBy","createdByName") VALUES(${id},${org},${month}::date,${input.requestId},${hash},${value.hash},${JSON.stringify(value.payload)}::jsonb,${reviewer.userId},${actor?.name??null}) RETURNING *`
    await tx.$executeRaw(Prisma.sql`INSERT INTO mtm_attendance_month_members(id,"organizationId","closeId","agentId",month) VALUES ${Prisma.join(ids.map(agentId=>Prisma.sql`(${randomUUID()},${org},${id},${agentId},${month}::date)`))}`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO mtm_attendance_month_days(id,"organizationId","closeId","agentId","sourceDate") VALUES ${Prisma.join(dates.map(day=>Prisma.sql`(${randomUUID()},${org},${id},${day.agentId},${new Date(`${day.sourceDate}T00:00:00Z`)}::date)`))}`)
    await tx.mtmAuditLog.create({data:{organizationId:org,actorUserId:reviewer.userId,action:"MTM_ATTENDANCE_MONTH_CLOSED",entity:"mtm_attendance_month",entityId:id,metadataKind:"mtm_attendance_month",newData:{month:input.month,employeeCount:ids.length,snapshotHash:value.hash}}})
    return {...summary(created,ids.length),idempotent:false}
  },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted,timeout:20000})
}
async function readSnapshot(tx:Tx,reviewer:AttendanceReviewer,id:string) {
  if(!uuid(id))return fail("INVALID",400)
  const actor=await currentAttendanceReadActor(tx,reviewer)
  const [row]=await tx.$queryRaw<Row[]>`SELECT * FROM mtm_attendance_month_closes WHERE "organizationId"=${reviewer.organizationId} AND id=${id}`
  if(!row)return fail("NOT_FOUND",404)
  const payload=verifiedAttendanceMonthSnapshot(row.payload,row.payloadHash)
  if(actor.scopedAgentIds!==null && payload.agentIds.some(id=>!actor.scopedAgentIds!.includes(id)))return fail("FORBIDDEN",403)
  return {row,payload}
}
export async function readAttendanceMonthTable(reviewer:AttendanceReviewer,id:string,locale:"az"|"ru"|"en") {
  return prisma.$transaction(async tx=>{const {row,payload}=await readSnapshot(tx,reviewer,id);return {month:row.month.toISOString().slice(0,7),table:payload.tables[locale] as AttendanceTable}},{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead})
}
export async function readAttendanceMonth(reviewer:AttendanceReviewer,id:string,locale:"az"|"ru"|"en"):Promise<AttendanceMonthDetail> {
  return prisma.$transaction(async tx=>{
    const {row,payload}=await readSnapshot(tx,reviewer,id),baseline=[...new Set(payload.coverage.flatMap(day=>day.correctionIds))]
    const corrections=await tx.$queryRaw<{id:string;agentId:string;sourceDate:Date;occurredAt:Date;requestId:string|null;beforeFacts:unknown;afterFacts:unknown;reviewerName:string|null}[]>`
      SELECT correction.id,correction."agentId",covered."sourceDate",correction."occurredAt",correction."requestId",correction."beforeFacts",correction."afterFacts",actor.name AS "reviewerName"
      FROM workforce_time_corrections correction JOIN mtm_agent_workdays day ON day."organizationId"=correction."organizationId" AND day.id=correction."workdayId" AND day."agentId"=correction."agentId"
      JOIN mtm_attendance_month_days covered ON covered."organizationId"=day."organizationId" AND covered."agentId"=day."agentId" AND covered."sourceDate"=day."workDate"
      JOIN users actor ON actor."organizationId"=correction."organizationId" AND actor.id=correction."actorUserId"
      WHERE covered."organizationId"=${reviewer.organizationId} AND covered."closeId"=${id} AND NOT(correction.id=ANY(${baseline}::text[])) ORDER BY correction."createdAt",correction.id LIMIT 1001`
    const table=payload.tables[locale] as AttendanceTable,employeeColumn=table.columns.findIndex(c=>c.key==="employee")
    return {...summary(row,payload.agentIds.length),table,moreCorrections:corrections.length>1000,corrections:corrections.slice(0,1000).map(c=>{
      const beforeRaw=c.beforeFacts as {kind?:unknown}|null,before=AttendanceCorrectionBasisSchema.parse(beforeRaw?.kind==="MISSING"?beforeRaw:{kind:"WORKDAY",facts:beforeRaw}),after=AttendanceCorrectionBasisSchema.parse({kind:"WORKDAY",facts:c.afterFacts})
      if(after.kind!=="WORKDAY")return fail("DAMAGED")
      return {id:c.id,employeeId:c.agentId,employeeName:String(table.rows.find(r=>r.key===c.agentId)?.cells[employeeColumn]??""),date:c.sourceDate.toISOString().slice(0,10),at:c.occurredAt.toISOString(),reviewerName:c.reviewerName,requestId:c.requestId,
        before:before.kind==="WORKDAY"?{startedAt:before.facts.startedAt,completedAt:before.facts.completedAt}:null,after:{startedAt:after.facts.startedAt,completedAt:after.facts.completedAt}}
    })}
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:15000})
}
export async function readAttendanceMonthDirectory(reviewer:AttendanceReviewer,raw:unknown):Promise<AttendanceMonthDirectory> {
  const parsed=AttendanceMonthQuerySchema.safeParse(raw);if(!parsed.success)return fail("INVALID",400)
  const {month,offset}=parsed.data,org=reviewer.organizationId
  return prisma.$transaction(async tx=>{
    const actor=await currentAttendanceReadActor(tx,reviewer)
    let writer:Awaited<ReturnType<typeof resolveAttendanceReviewerScope>>|null=null
    try{writer=await resolveAttendanceReviewerScope(tx,reviewer)}catch(e){if(!(e instanceof AttendanceRequestError && e.status===403))throw e}
    const employees=await tx.mtmAgent.findMany({where:{organizationId:org,...ATTENDANCE_TRACKED_CARD_WHERE,...(actor.scopedAgentIds===null?{}:{id:{in:[...actor.scopedAgentIds]}})},select:{id:true,name:true,userId:true,team:{select:{name:true}}},orderBy:[{name:"asc"},{id:"asc"}],skip:offset,take:51})
    const ids=employees.slice(0,50).map(e=>e.id),date=new Date(`${month}-01T00:00:00Z`)
    const closed=ids.length?await tx.$queryRaw<{agentId:string}[]>`SELECT "agentId" FROM mtm_attendance_month_members WHERE "organizationId"=${org} AND month=${date}::date AND "agentId"=ANY(${ids}::text[])`:[]
    const scope=actor.scopedAgentIds===null?Prisma.empty:Prisma.sql`AND NOT EXISTS(SELECT 1 FROM mtm_attendance_month_members member WHERE member."organizationId"=closed."organizationId" AND member."closeId"=closed.id AND NOT(member."agentId"=ANY(${actor.scopedAgentIds}::text[])))`
    const rows=await tx.$queryRaw<(Row & {employeeCount:number})[]>(Prisma.sql`SELECT closed.id,closed.month,closed."createdAt",closed."createdByName",(SELECT count(*)::int FROM mtm_attendance_month_members member WHERE member."organizationId"=closed."organizationId" AND member."closeId"=closed.id) AS "employeeCount" FROM mtm_attendance_month_closes closed WHERE closed."organizationId"=${org} AND closed.month=${date}::date ${scope} ORDER BY closed."createdAt" DESC,closed.id OFFSET ${offset} LIMIT 51`)
    return {month,canClose:writer!==null,employees:employees.slice(0,50).map(e=>({id:e.id,name:e.name,teamName:e.team?.name??null,closed:closed.some(c=>c.agentId===e.id),own:e.userId===reviewer.userId,canClose:writer!==null && e.userId!==reviewer.userId && (writer.scopedAgentIds===null||writer.scopedAgentIds.includes(e.id))})),moreEmployees:employees.length>50,items:rows.slice(0,50).map(r=>summary(r,r.employeeCount)),moreSnapshots:rows.length>50}
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:15000})
}
