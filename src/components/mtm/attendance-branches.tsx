"use client"

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { Building2, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { HomeCard, HomePill } from "@/components/mtm/home-parts"
import { AttendanceBranchInputSchema, AttendanceBranchAssignmentInputSchema,
  type AttendanceBranch, type AttendanceBranchEmployee, type AttendanceBranchDirectory, type AttendanceBranchAssignments } from "@/lib/mtm/attendance-branches-contract"

const URL = "/api/v1/mtm/attendance/branches"
const SELECT = "min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"
type Draft = { branchId: string | null; expectedRevisionId: string | null; name: string; address: string; latitude: string; longitude: string; radiusMeters: string; active: boolean }
type Pending = { url: string; body: ReturnType<typeof AttendanceBranchInputSchema.parse> | ReturnType<typeof AttendanceBranchAssignmentInputSchema.parse> }
const newDraft = (): Draft => ({ branchId: null, expectedRevisionId: null, name: "", address: "", latitude: "", longitude: "", radiusMeters: "150", active: true })

/** An unknown write retains one immutable request in memory. Its only write
 * action is an exact retry; locale changes cannot mutate or discard the body. */
export function MtmAttendanceBranches() {
  const t = useTranslations("mtmAttendance")
  const [tab,setTab] = useState<"branches" | "assignments">("branches")
  const [directory,setDirectory] = useState<AttendanceBranchDirectory | null>(null)
  const [assignments,setAssignments] = useState<AttendanceBranchAssignments | null>(null)
  const [draft,setDraft] = useState<Draft | null>(null)
  const [choices,setChoices] = useState<Record<string,string>>({})
  const [search,setSearch] = useState("")
  const [query,setQuery] = useState("")
  const [page,setPage] = useState(0)
  const [loading,setLoading] = useState(false)
  const [saving,setSaving] = useState(false)
  const [denied,setDenied] = useState(false)
  const [error,setError] = useState<string | null>(null)
  const [saved,setSaved] = useState(false)
  const [needsRefresh,setNeedsRefresh] = useState(false)
  const [pending,setPending] = useState<Pending | null>(null)
  const read = useRef<AbortController | null>(null)
  const write = useRef<AbortController | null>(null)
  const pendingRef = useRef<Pending | null>(null)
  const clearPrivate = useCallback(() => {
    setDirectory(null);setAssignments(null);setDraft(null);setChoices({});setSearch("");setQuery("");setSaved(false)
    setPending(null);pendingRef.current=null;setNeedsRefresh(false)
  },[])
  const load = useCallback(async (searchValue: string) => {
    if (pendingRef.current) return
    read.current?.abort()
    const controller = new AbortController();read.current=controller
    setLoading(true);setDirectory(null);setAssignments(null);setChoices({});setError(null)
    try {
      // Both reads describe one visible workspace; a refusal clears both halves.
      const responses = await Promise.all([fetch(URL,{cache:"no-store",signal:controller.signal}),fetch(`${URL}/assignments?${new URLSearchParams({search:searchValue})}`,{cache:"no-store",signal:controller.signal})])
      const bodies = await Promise.all(responses.map(response=>response.json().catch(()=>null)))
      if (controller.signal.aborted) return
      if (responses.some(response=>[401,403,404].includes(response.status))) {clearPrivate();setDenied(true);setError("branchesAccessUnavailable");return}
      if (responses.some(response=>!response.ok) || bodies.some(body=>body?.success!==true) || !Array.isArray(bodies[0].data?.branches) || !Array.isArray(bodies[1].data?.employees)) {setError("branchesLoadError");return}
      setDirectory(bodies[0].data as AttendanceBranchDirectory);setAssignments(bodies[1].data as AttendanceBranchAssignments)
      setChoices(Object.fromEntries((bodies[1].data.employees as AttendanceBranchEmployee[]).map(employee=>[employee.id,employee.primary?.branchId??""])))
      setNeedsRefresh(false);setDraft(null);setPage(0);setQuery(searchValue)
    } catch { if(!controller.signal.aborted)setError("branchesLoadError") }
    finally {if(!controller.signal.aborted)setLoading(false)}
  },[clearPrivate])
  useEffect(()=>{void load("");return()=>{read.current?.abort();write.current?.abort()}},[load])

  async function publish(operation: Pending) {
    if (write.current || loading || denied) return
    const controller=new AbortController();write.current=controller
    pendingRef.current=operation;setPending(operation);setSaving(true);setSaved(false);setError(null)
    try {
      const response=await fetch(operation.url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(operation.body),signal:controller.signal})
      const body=await response.json().catch(()=>null)
      if(controller.signal.aborted)return
      if([401,403,404].includes(response.status)){clearPrivate();setDenied(true);setError("branchesAccessUnavailable");return}
      if(response.ok && body?.success===true && typeof body.data?.idempotent==="boolean" && typeof (body.data.branch??body.data.primary)?.revisionId==="string"){
        pendingRef.current=null;setPending(null);setDraft(null);setSaved(true);await load(query);return
      }
      if(response.status===400 || response.status===409 || response.status===422){
        pendingRef.current=null;setPending(null)
        if(response.status===400)setError("branchesInvalid")
        else{setNeedsRefresh(true);setError(body?.code==="MTM_ATTENDANCE_BRANCH_TOO_LARGE"?"branchesTooLarge":"branchesChanged")}
      }else setError("branchesUnconfirmed")
    }catch{if(!controller.signal.aborted)setError("branchesUnconfirmed")}
    finally{if(write.current===controller)write.current=null;if(!controller.signal.aborted)setSaving(false)}
  }
  function submitBranch(event: FormEvent<HTMLFormElement>){
    event.preventDefault()
    if(!draft || directory?.canManageBranches!==true || blocked)return
    const parsed=AttendanceBranchInputSchema.safeParse({...draft,requestId:crypto.randomUUID(),latitude:draft.latitude.trim()?Number(draft.latitude):NaN,longitude:draft.longitude.trim()?Number(draft.longitude):NaN,radiusMeters:draft.radiusMeters.trim()?Number(draft.radiusMeters):NaN})
    if(!parsed.success){setError("branchesInvalid");return}void publish({url:URL,body:parsed.data})
  }
  function assign(employee: AttendanceBranchEmployee){
    if(!employee.canAssign || blocked)return
    const parsed=AttendanceBranchAssignmentInputSchema.safeParse({requestId:crypto.randomUUID(),expectedRevisionId:employee.primary?.revisionId??null,agentId:employee.id,branchId:choices[employee.id]||null})
    if(!parsed.success){setError("branchesInvalid");return}void publish({url:`${URL}/assignments`,body:parsed.data})
  }
  const blocked=loading||saving||Boolean(pending)||needsRefresh||denied||!directory
  const branches=directory?.branches??[]
  const names=new Map(branches.map(branch=>[branch.id,branch]))
  const field=(key:keyof Pick<Draft,"name"|"address"|"latitude"|"longitude"|"radiusMeters">,label:string,type="text")=><div className="min-w-0 space-y-2"><label htmlFor={`branch-${key}`} className="text-sm font-medium">{t(label)}</label><Input id={`branch-${key}`} className="min-h-11" type={type} step={type==="number"?key==="radiusMeters"?"1":"any":undefined} maxLength={key==="name"?160:key==="address"?500:30} value={draft?.[key]??""} disabled={blocked} onChange={event=>setDraft(current=>current?{...current,[key]:event.target.value}:current)}/></div>
  function edit(branch:AttendanceBranch){setError(null);setSaved(false);setDraft({branchId:branch.id,expectedRevisionId:branch.revisionId,name:branch.name,address:branch.address,latitude:String(branch.latitude),longitude:String(branch.longitude),radiusMeters:String(branch.radiusMeters),active:branch.active})}
  return <div className="space-y-5" data-testid="attendance-branches">
    <Link href="/mtm/attendance" className="inline-flex min-h-11 items-center text-sm text-primary hover:underline">{t("branchesBack")}</Link>
    <div><h1 className="text-2xl font-bold tracking-tight">{t("branchesTitle")}</h1><p className="mt-2 max-w-prose text-sm text-muted-foreground">{t("branchesIntro")}</p></div>
    {!denied?<div className="flex flex-wrap gap-2" role="group" aria-label={t("branchesNavigation")}><Button variant={tab==="branches"?"default":"outline"} className="min-h-11" disabled={saving||Boolean(pending)} onClick={()=>setTab("branches")}>{t("branchesTitle")}</Button><Button variant={tab==="assignments"?"default":"outline"} className="min-h-11" disabled={saving||Boolean(pending)} onClick={()=>setTab("assignments")}>{t("branchesAssignments")}</Button><Button variant="outline" className="min-h-11" disabled={loading||saving||Boolean(pending)} onClick={()=>void load(query)}>{t("branchesRefresh")}</Button></div>:null}
    {loading?<p role="status" className="text-sm text-muted-foreground">{t("branchesLoading")}</p>:null}
    {error?<p role="alert" className="max-w-prose text-sm text-destructive">{t(error)}</p>:null}
    {saved?<p role="status" className="text-sm text-emerald-700">{t("branchesSaved")}</p>:null}
    {pending&&!saving?<Button className="min-h-11" onClick={()=>void publish(pending)}>{t("branchesCheckWrite")}</Button>:null}
    {directory&&!denied&&tab==="branches"?<>
      <HomeCard testId="branches-list" title={t("branchesTitle")} icon={<Building2 className="h-4 w-4" aria-hidden="true"/>} tone="orange"><div className="space-y-4 py-4">
        {directory.canManageBranches===true?<Button className="min-h-11" disabled={blocked} onClick={()=>{setDraft(newDraft());setError(null);setSaved(false)}}>{t("branchesAdd")}</Button>:<p className="text-sm text-muted-foreground">{t("branchesReadOnly")}</p>}
        {branches.length?<div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="hidden md:table-header-group"><tr className="border-b text-xs text-muted-foreground">{["branchesNameAddress","branchesPoint","branchesRadius","branchesState","branchesRevision","branchesActions"].map(key=><th key={key} className="px-3 py-3 font-medium">{t(key)}</th>)}</tr></thead><tbody className="block md:table-row-group">{branches.slice(page*25,page*25+25).map(branch=><tr key={branch.id} className="block border-b py-3 last:border-0 md:table-row" data-testid="branch-row"><td className="block px-3 py-2 md:table-cell"><strong className="break-words">{branch.name}</strong><span className="mt-1 block break-words text-xs text-muted-foreground">{branch.address}</span></td><td className="block px-3 py-2 tabular-nums md:table-cell"><span className="text-xs text-muted-foreground md:hidden">{t("branchesPoint")}: </span>{branch.latitude}, {branch.longitude}</td><td className="block px-3 py-2 md:table-cell">{t("branchesMeters",{count:branch.radiusMeters})}</td><td className="block px-3 py-2 md:table-cell"><HomePill tone={branch.active?"green":"zinc"}>{t(branch.active?"branchesActive":"branchesArchived")}</HomePill></td><td className="block px-3 py-2 text-xs text-muted-foreground md:table-cell">{t("branchesVersion",{version:branch.version})}</td><td className="block px-3 py-2 md:table-cell">{directory.canManageBranches===true?<Button variant="outline" className="min-h-11" disabled={blocked} aria-label={t("branchesEditNamed",{name:branch.name})} onClick={()=>edit(branch)}>{t("branchesEdit")}</Button>:"—"}</td></tr>)}</tbody></table></div>:<p className="text-sm text-muted-foreground">{t("branchesEmpty")}</p>}
        {branches.length>25?<div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={page===0} onClick={()=>setPage(value=>value-1)}>{t("branchesPrevious")}</Button><span className="text-xs text-muted-foreground">{t("branchesPage",{page:page+1,pages:Math.ceil(branches.length/25),count:branches.length})}</span><Button variant="outline" disabled={(page+1)*25>=branches.length} onClick={()=>setPage(value=>value+1)}>{t("branchesNext")}</Button></div>:null}
      </div></HomeCard>
      {draft&&directory.canManageBranches===true?<HomeCard testId="branches-editor" title={t(draft.branchId?"branchesEdit":"branchesAdd")} icon={<Building2 className="h-4 w-4" aria-hidden="true"/>} tone="orange"><form aria-label={t("branchesEditor")} onSubmit={submitBranch} className="space-y-5 py-4"><div className="grid min-w-0 gap-4 sm:grid-cols-2">{field("name","branchesName")}{field("address","branchesAddress")}{field("latitude","branchesLatitude","number")}{field("longitude","branchesLongitude","number")}{field("radiusMeters","branchesRadius","number")}<div className="space-y-2"><label htmlFor="branch-active" className="text-sm font-medium">{t("branchesState")}</label><select id="branch-active" className={SELECT} value={String(draft.active)} disabled={blocked} onChange={event=>setDraft({...draft,active:event.target.value==="true"})}><option value="true">{t("branchesActive")}</option><option value="false">{t("branchesArchived")}</option></select></div></div><p className="max-w-prose text-xs text-muted-foreground">{t("branchesHistoryHint")}</p><div className="flex flex-wrap gap-3"><Button type="submit" className="min-h-11" disabled={blocked}>{t(saving?"branchesSaving":"branchesSave")}</Button><Button type="button" variant="outline" className="min-h-11" disabled={saving||Boolean(pending)} onClick={()=>setDraft(null)}>{t("branchesCancel")}</Button></div></form></HomeCard>:null}
    </>:null}
    {directory&&!denied&&tab==="assignments"?<HomeCard testId="branches-assignments" title={t("branchesAssignments")} icon={<Users className="h-4 w-4" aria-hidden="true"/>} tone="orange"><div className="space-y-5 py-4"><p className="max-w-prose text-sm text-muted-foreground">{t("branchesAssignmentHint")}</p><form aria-label={t("branchesSearch")} className="flex flex-wrap items-end gap-3" onSubmit={event=>{event.preventDefault();if(!blocked)void load(search.trim())}}><div className="min-w-0 flex-1 basis-64 space-y-2"><label htmlFor="branch-employee-search" className="text-sm font-medium">{t("branchesSearch")}</label><Input id="branch-employee-search" type="search" maxLength={100} className="min-h-11" value={search} disabled={blocked} onChange={event=>setSearch(event.target.value)}/></div><Button className="min-h-11" disabled={blocked}>{t("branchesFind")}</Button></form>
      {assignments?.hasMore?<p className="text-sm text-muted-foreground">{t("branchesMore")}</p>:null}
      {assignments?.employees.length?<ul className="divide-y" aria-label={t("branchesEmployees")}>{assignments.employees.map(employee=><li key={employee.id} className="grid min-w-0 items-center gap-4 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" data-testid="branch-employee"><div className="min-w-0"><h3 className="break-words text-sm font-semibold">{employee.name}</h3><p className="mt-1 break-words text-xs text-muted-foreground">{employee.teamName??t("branchesNoTeam")}</p>{employee.primary?<p className="mt-1 text-xs text-muted-foreground">{t("branchesVersion",{version:employee.primary.version})}</p>:null}</div><div className="min-w-0 space-y-2"><label htmlFor={`primary-${employee.id}`} className="text-xs text-muted-foreground">{t("branchesPrimaryNamed",{name:employee.name})}</label><select id={`primary-${employee.id}`} className={SELECT} value={choices[employee.id]??""} disabled={blocked||employee.canAssign!==true} onChange={event=>setChoices(current=>({...current,[employee.id]:event.target.value}))}><option value="">{t("branchesUnassigned")}</option>{branches.filter(branch=>branch.active||branch.id===employee.primary?.branchId).map(branch=><option key={branch.id} value={branch.id} disabled={!branch.active}>{branch.name}{branch.active?"":` · ${t("branchesArchived")}`}</option>)}{employee.primary?.branchId&&!names.has(employee.primary.branchId)?<option value={employee.primary.branchId} disabled>{t("branchesUnavailable")}</option>:null}</select></div>{employee.canAssign===true?<Button variant="outline" className="min-h-11" disabled={blocked||(choices[employee.id]||null)===(employee.primary?.branchId??null)} aria-label={t("branchesAssignNamed",{name:employee.name})} onClick={()=>assign(employee)}>{t("branchesSave")}</Button>:<span className="text-xs text-muted-foreground">{t("branchesReadOnly")}</span>}</li>)}</ul>:<p className="text-sm text-muted-foreground">{t("branchesNoEmployees")}</p>}
    </div></HomeCard>:null}
  </div>
}
