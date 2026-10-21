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
import { AttendanceMonthCloseSchema, AttendanceMonthN1tQuerySchema, AttendanceMonthQuerySchema, AttendanceMonthSelectionSchema, type AttendanceMonthBlocker, type AttendanceMonthCandidate, type AttendanceMonthCorrection, type AttendanceMonthDirectory, type AttendanceMonthDetail, type AttendanceMonthN1tForm, type AttendanceMonthN1tState, type AttendanceMonthPayload, type AttendanceMonthSelection, type AttendanceMonthSummary } from "@/lib/mtm/attendance-month-contract"
import { attendanceMonthHash, attendanceMonthRange, attendanceN1tConfig, attendanceTableText, buildAttendanceMonthSnapshot, frozenAttendanceMonthTable, frozenAttendanceN1tBlock, verifiedAttendanceMonthSnapshot } from "@/lib/mtm/attendance-month-snapshot"
import { joinAttendanceN1t, type AttendanceN1tBlock } from "@/lib/mtm/attendance-n1t-form"
import { filterMtmAttendanceRows } from "@/lib/mtm/attendance-report"
import type { AttendanceTable } from "@/lib/mtm/attendance-table"
import { currentDateKey } from "@/lib/mtm/mobile-week"
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
type Projection=Awaited<ReturnType<typeof readAttendanceProjectionInTransaction>>
function built(report:Projection, selection:AttendanceMonthSelection) {
  try{return buildAttendanceMonthSnapshot(report,selection,new Date())}catch(error){if(error instanceof Error && error.message.startsWith("MTM_ATTENDANCE_MONTH_"))throw new AttendanceRequestError(error.message,409);throw error}
}
async function snapshot(tx:Tx, reviewer:AttendanceReviewer, selection:AttendanceMonthSelection, asOf:Date) {
  const range=attendanceMonthRange(selection.month)
  const report=await readAttendanceProjectionInTransaction(tx,{organizationId:reviewer.organizationId,authorizedEmployeeIds:selection.agentIds,query:{...range,form:"ALL"},now:asOf})
  return built(report,selection)
}
export async function previewAttendanceMonth(reviewer:AttendanceReviewer,raw:unknown,locale:"az"|"ru"|"en") {
  const parsed=AttendanceMonthSelectionSchema.safeParse(raw);if(!parsed.success)return fail("INVALID",400)
  return prisma.$transaction(async tx=>{await writeScope(tx,reviewer,parsed.data.agentIds);const value=await snapshot(tx,reviewer,parsed.data,new Date()),frozen=frozenAttendanceMonthTable(value.payload,locale);return {month:parsed.data.month,agentIds:value.payload.agentIds,hash:value.hash,asOf:value.payload.asOf,form:frozen.form,table:frozen.table,blockers:value.blockers}}, {isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:15000})
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
/** The closed month's file: its frozen N-1t (the month grid only for a month closed before the N-1t was frozen). */
export async function readAttendanceMonthTable(reviewer:AttendanceReviewer,id:string,locale:"az"|"ru"|"en") {
  return prisma.$transaction(async tx=>{const {row,payload}=await readSnapshot(tx,reviewer,id);return {month:row.month.toISOString().slice(0,7),...frozenAttendanceMonthTable(payload,locale)}},{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead})
}
type CorrectionRow={id:string;agentId:string;sourceDate:Date;occurredAt:Date;requestId:string|null;beforeFacts:unknown;afterFacts:unknown;reviewerName:string|null}
/**
 * The approved corrections that changed frozen days after their close; those already in a
 * snapshot's own coverage are its baseline. `table` names the people as the frozen form does.
 */
async function correctionsAfterClose(tx:Tx,organizationId:string,closeIds:readonly string[],payloads:readonly AttendanceMonthPayload[],table:AttendanceTable):Promise<{corrections:AttendanceMonthCorrection[];moreCorrections:boolean}> {
  const baseline=[...new Set(payloads.flatMap(payload=>payload.coverage.flatMap(day=>day.correctionIds)))]
  const corrections=await tx.$queryRaw<CorrectionRow[]>`
    SELECT correction.id,correction."agentId",covered."sourceDate",correction."occurredAt",correction."requestId",correction."beforeFacts",correction."afterFacts",actor.name AS "reviewerName"
    FROM workforce_time_corrections correction JOIN mtm_agent_workdays day ON day."organizationId"=correction."organizationId" AND day.id=correction."workdayId" AND day."agentId"=correction."agentId"
    JOIN mtm_attendance_month_days covered ON covered."organizationId"=day."organizationId" AND covered."agentId"=day."agentId" AND covered."sourceDate"=day."workDate"
    JOIN users actor ON actor."organizationId"=correction."organizationId" AND actor.id=correction."actorUserId"
    WHERE covered."organizationId"=${organizationId} AND covered."closeId"=ANY(${[...closeIds]}::text[]) AND NOT(correction.id=ANY(${baseline}::text[])) ORDER BY correction."createdAt",correction.id LIMIT 1001`
  const employeeColumn=table.columns.findIndex(c=>c.key==="employee")
  return {moreCorrections:corrections.length>1000,corrections:corrections.slice(0,1000).map(c=>{
    const beforeRaw=c.beforeFacts as {kind?:unknown}|null,before=AttendanceCorrectionBasisSchema.parse(beforeRaw?.kind==="MISSING"?beforeRaw:{kind:"WORKDAY",facts:beforeRaw}),after=AttendanceCorrectionBasisSchema.parse({kind:"WORKDAY",facts:c.afterFacts})
    if(after.kind!=="WORKDAY")return fail("DAMAGED")
    return {id:c.id,employeeId:c.agentId,employeeName:String(table.rows.find(r=>r.key===c.agentId)?.cells[employeeColumn]??""),date:c.sourceDate.toISOString().slice(0,10),at:c.occurredAt.toISOString(),reviewerName:c.reviewerName,requestId:c.requestId,
      before:before.kind==="WORKDAY"?{startedAt:before.facts.startedAt,completedAt:before.facts.completedAt}:null,after:{startedAt:after.facts.startedAt,completedAt:after.facts.completedAt}}
  })}
}
/** A closed month as it was frozen, and the approved corrections that changed its days afterwards. */
async function monthDetail(tx:Tx,organizationId:string,row:Row,payload:AttendanceMonthPayload,locale:"az"|"ru"|"en"):Promise<AttendanceMonthDetail> {
  const {form,table}=frozenAttendanceMonthTable(payload,locale)
  return {...summary(row,payload.agentIds.length),form,agentIds:payload.agentIds,table,...await correctionsAfterClose(tx,organizationId,[row.id],[payload],table)}
}
export async function readAttendanceMonth(reviewer:AttendanceReviewer,id:string,locale:"az"|"ru"|"en"):Promise<AttendanceMonthDetail> {
  return prisma.$transaction(async tx=>{
    const {row,payload}=await readSnapshot(tx,reviewer,id)
    return monthDetail(tx,reviewer.organizationId,row,payload,locale)
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:15000})
}
/** Closes of one month a viewer may open: only those whose every employee is in the viewer's scope. */
function visibleClosesScope(scopedAgentIds:readonly string[]|null) {
  return scopedAgentIds===null?Prisma.empty:Prisma.sql`AND NOT EXISTS(SELECT 1 FROM mtm_attendance_month_members member WHERE member."organizationId"=closed."organizationId" AND member."closeId"=closed.id AND NOT(member."agentId"=ANY(${[...scopedAgentIds]}::text[])))`
}
/**
 * One close holds at most 100 people (AttendanceMonthSelectionSchema), so a larger roster closes in
 * blocks of 100 that read back as one N-1t (attendance-n1t-form.ts says why the limit stays).
 */
const N1T_CLOSE_SIZE=100,N1T_BLOCKERS_SHOWN=50
/**
 * Closes that make one month's form: far past what one press makes — a report holds at most
 * 100 000 lines, about 3 200 people a month, 33 closes of 100 — and past one close per person.
 */
const N1T_FORM_CLOSES=1000
type VisibleMonth={form:AttendanceMonthN1tForm|null;legacy:AttendanceMonthDetail[];more:boolean;shown:Set<string>}
/**
 * The closed part of a month a viewer may open: every frozen N-1t joined into one form, numbered
 * 1..N in close order with one set of totals, and months closed before the N-1t was frozen, each
 * with its own month grid. `notes` reads the corrections approved since (not needed for a file).
 */
async function visibleMonth(tx:Tx,organizationId:string,scopedAgentIds:readonly string[]|null,month:string,locale:"az"|"ru"|"en",notes=true):Promise<VisibleMonth> {
  const rows=await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM mtm_attendance_month_closes closed WHERE closed."organizationId"=${organizationId} AND closed.month=${new Date(`${month}-01T00:00:00Z`)}::date ${visibleClosesScope(scopedAgentIds)} ORDER BY closed."createdAt",closed.id LIMIT ${N1T_FORM_CLOSES+1}`)
  if(rows.length>N1T_FORM_CLOSES)return {form:null,legacy:[],more:true,shown:new Set()}
  const frozen=rows.map(row=>({row,payload:verifiedAttendanceMonthSnapshot(row.payload,row.payloadHash)}))
  const n1t=frozen.flatMap(item=>{const block=frozenAttendanceN1tBlock(item.payload,locale);return block?[{...item,block}]:[]})
  const legacy:AttendanceMonthDetail[]=[]
  for(const item of frozen)if(!item.payload.n1t)legacy.push(notes?await monthDetail(tx,organizationId,item.row,item.payload,locale):{...summary(item.row,item.payload.agentIds.length),...frozenAttendanceMonthTable(item.payload,locale),agentIds:item.payload.agentIds,corrections:[],moreCorrections:false})
  let form:AttendanceMonthN1tForm|null=null
  if(n1t.length){
    const table=joinAttendanceN1t(n1t.map(item=>item.block),attendanceTableText(locale))
    form={month,table,employeeCount:n1t.reduce((total,item)=>total+item.payload.agentIds.length,0),agentIds:n1t.flatMap(item=>item.payload.agentIds),closes:n1t.map(item=>summary(item.row,item.payload.agentIds.length)),
      ...(notes?await correctionsAfterClose(tx,organizationId,n1t.map(item=>item.row.id),n1t.map(item=>item.payload),table):{corrections:[],moreCorrections:false})}
  }
  return {form,legacy,more:false,shown:new Set(frozen.flatMap(item=>item.payload.agentIds))}
}
/**
 * Personnel → Reports → N-1t for one month (owner, 2026-10-20: production behaves like the clip).
 * A closed month answers with its frozen N-1t as one form, who closed it and when, and the
 * corrections approved after the close; a finished open month answers with the one N-1t
 * «Bu tabeli bağla» will freeze for everyone the viewer may close — sent as the exact snapshots of
 * its blocks of 100 — or with the days that block it. Nothing is written here.
 */
export async function readAttendanceMonthN1t(reviewer:AttendanceReviewer,raw:unknown):Promise<AttendanceMonthN1tState> {
  const parsed=AttendanceMonthN1tQuerySchema.safeParse(raw);if(!parsed.success)return fail("INVALID",400)
  const {month,locale}=parsed.data,org=reviewer.organizationId,date=new Date(`${month}-01T00:00:00Z`),{from,to}=attendanceMonthRange(month)
  return prisma.$transaction(async tx=>{
    const actor=await currentAttendanceReadActor(tx,reviewer)
    let writer:Awaited<ReturnType<typeof resolveAttendanceReviewerScope>>|null=null
    try{writer=await resolveAttendanceReviewerScope(tx,reviewer)}catch(e){if(!(e instanceof AttendanceRequestError && e.status===403))throw e}
    const visible=await visibleMonth(tx,org,actor.scopedAgentIds,month,locale)
    const people:{id:string;userId:string|null}[]=await tx.mtmAgent.findMany({where:{organizationId:org,...ATTENDANCE_TRACKED_CARD_WHERE,...(actor.scopedAgentIds===null?{}:{id:{in:[...actor.scopedAgentIds]}})},select:{id:true,userId:true},orderBy:[{name:"asc"},{id:"asc"}]})
    const members:{agentId:string}[]=people.length?await tx.$queryRaw<{agentId:string}[]>`SELECT "agentId" FROM mtm_attendance_month_members WHERE "organizationId"=${org} AND month=${date}::date AND "agentId"=ANY(${people.map(p=>p.id)}::text[])`:[]
    const closed=new Set<string>(members.map(m=>m.agentId)),now=new Date()
    // Where the day starts first: if the month runs even there, it runs everywhere, and no preview is needed.
    let finished=currentDateKey(now,"Pacific/Kiritimati")>to,open=people.filter(p=>!closed.has(p.id))
    let eligible:string[]=[],report:Projection|null=null,readFor=0
    if(finished && open.length){
      readFor=open.length
      report=await readAttendanceProjectionInTransaction(tx,{organizationId:org,authorizedEmployeeIds:open.map(p=>p.id),query:{from,to,form:"ALL"},now})
      // The N-1t has a line only for people counted in the month: someone whose attendance starts
      // later, or who is excluded for the whole month, is neither open nor closable. The rest keep
      // the order of the N-1t's own lines, so that blocks cut from it read back in that order.
      const lines=new Map<string,number>()
      for(const row of filterMtmAttendanceRows(report.accountingRows??report.rows,attendanceN1tConfig(from,to).filters))if(!lines.has(row.employeeId))lines.set(row.employeeId,lines.size)
      open=open.filter(p=>lines.has(p.id)).sort((a,b)=>lines.get(a.id)!-lines.get(b.id)!)
      if(writer)eligible=open.filter(p=>p.userId!==reviewer.userId && (writer!.scopedAgentIds===null||writer!.scopedAgentIds.includes(p.id))).map(p=>p.id)
    }
    const ownOpen=open.some(p=>p.userId===reviewer.userId)
    const blocks:(AttendanceMonthCandidate&{block:AttendanceN1tBlock})[]=[],blockers:AttendanceMonthBlocker[]=[]
    let blockerCount=0
    for(let index=0;finished && index<eligible.length;index+=N1T_CLOSE_SIZE){
      const selection={month,agentIds:eligible.slice(index,index+N1T_CLOSE_SIZE)}
      // The one projection already read is exactly the close's own when it holds just these people.
      const value=report && readFor===selection.agentIds.length && eligible.length<=N1T_CLOSE_SIZE?built(report,selection):await snapshot(tx,reviewer,selection,now)
      if(value.ongoing){finished=false;blocks.length=0;blockers.length=0;blockerCount=0;break}
      const block=frozenAttendanceN1tBlock(value.payload,locale)!,employee=block.table.columns.findIndex(c=>c.key==="employee")
      blocks.push({agentIds:value.payload.agentIds,hash:value.hash,asOf:value.payload.asOf,block})
      blockerCount+=value.blockers.length
      for(const blocker of value.blockers.slice(0,Math.max(0,N1T_BLOCKERS_SHOWN-blockers.length)))blockers.push({...blocker,employeeName:String(block.table.rows.find(r=>r.key===blocker.employeeId)?.cells[employee]??"")})
    }
    // What the press freezes, as one N-1t: the blocks' own lines continue the part already closed.
    const preview=blocks.length?joinAttendanceN1t(blocks.map(item=>item.block),attendanceTableText(locale),(visible.form?.employeeCount??0)+1):null
    return {month,finished,canClose:writer!==null,closed:visible.form,legacy:visible.legacy,moreCloses:visible.more,closedElsewhere:visible.more?0:[...closed].filter(id=>!visible.shown.has(id)).length,
      open:open.length,ownOpen,notIncluded:writer?open.length-eligible.length-(ownOpen?1:0):0,candidates:blocks.map(item=>({agentIds:item.agentIds,hash:item.hash,asOf:item.asOf})),preview,blockers,moreBlockers:blockerCount-blockers.length}
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:30000})
}
/** The month's N-1t file: every frozen N-1t of the month the viewer may open, as the one form the screen shows. */
export async function readAttendanceMonthN1tForm(reviewer:AttendanceReviewer,raw:unknown):Promise<{month:string;table:AttendanceTable}> {
  const parsed=AttendanceMonthN1tQuerySchema.safeParse(raw);if(!parsed.success)return fail("INVALID",400)
  const {month,locale}=parsed.data
  return prisma.$transaction(async tx=>{
    const actor=await currentAttendanceReadActor(tx,reviewer)
    const visible=await visibleMonth(tx,reviewer.organizationId,actor.scopedAgentIds,month,locale,false)
    if(visible.more)return fail("TOO_LARGE")
    if(!visible.form)return fail("NOT_FOUND",404)
    return {month,table:visible.form.table}
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:30000})
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
    const scope=visibleClosesScope(actor.scopedAgentIds)
    const rows=await tx.$queryRaw<(Row & {employeeCount:number})[]>(Prisma.sql`SELECT closed.id,closed.month,closed."createdAt",closed."createdByName",(SELECT count(*)::int FROM mtm_attendance_month_members member WHERE member."organizationId"=closed."organizationId" AND member."closeId"=closed.id) AS "employeeCount" FROM mtm_attendance_month_closes closed WHERE closed."organizationId"=${org} AND closed.month=${date}::date ${scope} ORDER BY closed."createdAt" DESC,closed.id OFFSET ${offset} LIMIT 51`)
    return {month,canClose:writer!==null,employees:employees.slice(0,50).map(e=>({id:e.id,name:e.name,teamName:e.team?.name??null,closed:closed.some(c=>c.agentId===e.id),own:e.userId===reviewer.userId,canClose:writer!==null && e.userId!==reviewer.userId && (writer.scopedAgentIds===null||writer.scopedAgentIds.includes(e.id))})),moreEmployees:employees.length>50,items:rows.slice(0,50).map(r=>summary(r,r.employeeCount)),moreSnapshots:rows.length>50}
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:15000})
}
