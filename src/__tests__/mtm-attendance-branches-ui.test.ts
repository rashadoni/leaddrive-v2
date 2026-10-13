// @vitest-environment jsdom
import { readFileSync,mkdirSync,writeFileSync } from "node:fs"
import { join } from "node:path"
import { act,createElement } from "react"
import { createRoot,type Root } from "react-dom/client"
import { createTranslator,NextIntlClientProvider } from "next-intl"
import { beforeEach,afterEach,describe,expect,it,vi } from "vitest"
import { MtmAttendanceBranches } from "@/components/mtm/attendance-branches"
import type { AttendanceBranch,AttendanceBranchDirectory,AttendanceBranchAssignments } from "@/lib/mtm/attendance-branches-contract"
;(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
const messages=Object.fromEntries(["ru","az","en"].map(locale=>[locale,JSON.parse(readFileSync(`messages/${locale}.json`,"utf8"))]))
const SITE="b0000000-0000-4000-8000-000000000001",REV="b0000000-0000-4000-8000-000000000002",NEXT="b0000000-0000-4000-8000-000000000003"
const fixture=():AttendanceBranch=>({id:SITE,revisionId:REV,version:1,name:"Demo Centre",address:"Demo Street 12",latitude:40.4,longitude:49.85,radiusMeters:150,active:true,createdAt:"2026-10-13T08:00:00.000Z"})
const response=(data:unknown,status=200,code="PRIVATE_SERVER_TRACE")=>new Response(JSON.stringify({success:status<400,data,code}),{status})
const fetchMock=vi.fn<typeof fetch>()
let root:Root,container:HTMLDivElement,locale:"ru"|"az"|"en",directory:AttendanceBranchDirectory,assignments:AttendanceBranchAssignments,unmounted:boolean
const t=(key:string,values?:Record<string,string|number>)=>createTranslator({locale,messages:messages[locale],namespace:"mtmAttendance"})(key,values)
const button=(key:string)=>[...container.querySelectorAll<HTMLButtonElement>("button")].find(button=>button.textContent===t(key))!
const click=async(key:string)=>{await act(async()=>button(key).click())}
const postCalls=()=>fetchMock.mock.calls.filter(([,options])=>options?.method==="POST")
async function render(language=locale){locale=language;const props={locale,messages:messages[locale],timeZone:"Asia/Baku",children:createElement(MtmAttendanceBranches)};await act(async()=>root.render(createElement(NextIntlClientProvider,props)))}
async function edit(id:string,value:string){await act(async()=>{const input=container.querySelector<HTMLInputElement|HTMLSelectElement>(`#${id}`)!;Object.getOwnPropertyDescriptor(input.tagName==="SELECT"?HTMLSelectElement.prototype:HTMLInputElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}))})}
async function submit(){await act(async()=>container.querySelector('[data-testid="branches-editor"] form')!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})))}
async function newBranch(){await click("branchesAdd");for(const[id,value]of[["name","Fictional North"],["address","Demo Avenue 8"],["latitude","0"],["longitude","0"]])await edit(`branch-${id}`,value)}
function capture(view:string){const dir=process.env.MTM_ATTENDANCE_RENDER_DIR;if(!dir)return;mkdirSync(dir,{recursive:true});const clone=container.cloneNode(true) as HTMLElement;container.querySelectorAll("input").forEach((field,i)=>clone.querySelectorAll("input")[i].setAttribute("value",field.value));container.querySelectorAll("select").forEach((field,i)=>[...clone.querySelectorAll("select")[i].options].forEach(option=>{if(option.value===field.value)option.setAttribute("selected","");else option.removeAttribute("selected")}));writeFileSync(join(dir,`attendance-branches-${view}-${locale}.html`),`<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="attendance.css"><style>html{background:#f6f7f9;color:#18181b}body{width:100%;max-width:1360px;margin:auto;padding:32px;font-family:Arial,sans-serif}*,*::before,*::after{box-sizing:border-box}@media(max-width:600px){body{padding:16px}}</style></head><body>${clone.innerHTML}</body></html>`)}
beforeEach(()=>{
 locale="ru";unmounted=false;container=document.createElement("div");document.body.append(container);root=createRoot(container)
 directory={branches:[fixture()],canManageBranches:true};assignments={employees:[{id:"fictional-a",name:"Aylin Demo",teamName:"Demo Centre",canAssign:true,primary:null},{id:"fictional-b",name:"Murad Demo",teamName:"Demo North",canAssign:false,primary:{revisionId:REV,version:1,branchId:SITE,createdAt:"2026-10-13T08:00:00.000Z"}}],hasMore:false}
 fetchMock.mockReset();fetchMock.mockImplementation(async(url,options)=>options?.method==="POST"?response({branch:{...fixture(),revisionId:NEXT},idempotent:false}):response(String(url).includes("/assignments")?assignments:directory));vi.stubGlobal("fetch",fetchMock)
})
afterEach(async()=>{if(!unmounted)await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals()})
describe("actual MTM branch registry and primary assignment editor",()=>{
 it.each(["ru","az","en"] as const)("renders editable registry and scoped assignments in %s",async language=>{
   await render(language);expect(container.textContent).toContain(t("branchesTitle"));expect(container.textContent).toContain("Demo Centre");expect(container.textContent).not.toMatch(/mtmAttendance\.|undefined/)
   await click("branchesEdit");capture("registry")
   await click("branchesAssignments");expect(container.querySelectorAll('[data-testid="branch-employee"]')).toHaveLength(2)
   expect((container.querySelector("#primary-fictional-b") as HTMLSelectElement).disabled).toBe(true);capture("assignments")
 })
 it("saves validated zero coordinates and an immutable update version through the real editor",async()=>{
   await render();await click("branchesEdit");await edit("branch-name","Fictional renamed");await edit("branch-latitude","0");await edit("branch-active","false");await submit()
   const payload=JSON.parse(postCalls()[0][1]!.body as string)
   expect(payload).toMatchObject({branchId:SITE,expectedRevisionId:REV,name:"Fictional renamed",latitude:0,active:false})
   expect(payload.requestId).toMatch(/^[a-f0-9-]{36}$/)
   expect(container.textContent).toContain(t("branchesSaved"));expect(container.querySelector('[data-testid="branches-editor"]')).toBeNull()
 })
 it("does not send incomplete coordinates or invalid radii",async()=>{
   await render();await newBranch();await edit("branch-radiusMeters","24");await submit();expect(postCalls()).toHaveLength(0)
   expect(container.textContent).toContain(t("branchesInvalid"));await edit("branch-radiusMeters","150");await edit("branch-longitude","");await submit();expect(postCalls()).toHaveLength(0)
 })
 it("assigns and clears one employee with the exact previously loaded revision",async()=>{
   assignments.employees[0].primary={revisionId:REV,version:4,branchId:SITE,createdAt:"2026-10-13T08:00:00.000Z"}
   await render();await click("branchesAssignments");await edit("primary-fictional-a","")
   await act(async()=>container.querySelector<HTMLButtonElement>(`button[aria-label="${t("branchesAssignNamed",{name:"Aylin Demo"})}"]`)!.click())
   expect(postCalls()[0][0]).toBe("/api/v1/mtm/attendance/branches/assignments")
   expect(JSON.parse(postCalls()[0][1]!.body as string)).toMatchObject({agentId:"fictional-a",branchId:null,expectedRevisionId:REV})
 })
 it("read-only grant never renders registry controls or enables assignments",async()=>{
   directory.canManageBranches=false;assignments.employees.forEach(employee=>employee.canAssign=false)
   await render();expect(button("branchesAdd")).toBeUndefined();expect(button("branchesEdit")).toBeUndefined()
   await click("branchesAssignments");expect([...container.querySelectorAll("select")].every(field=>field.disabled)).toBe(true);expect(postCalls()).toHaveLength(0)
 })
 it("retries a lost response with the identical body and UUID after a locale change",async()=>{
   const original=fetchMock.getMockImplementation()!;let failed=false
   fetchMock.mockImplementation(async(url,options)=>{if(options?.method==="POST"&&!failed){failed=true;throw new Error("PRIVATE_NETWORK")};return original(url,options)})
   await render();await newBranch();await submit();expect(container.textContent).toContain(t("branchesUnconfirmed"));const body=postCalls()[0][1]!.body
   expect(button("branchesRefresh").disabled).toBe(true);expect((container.querySelector("#branch-name") as HTMLInputElement).disabled).toBe(true)
   await render("az");expect(container.textContent).toContain(t("branchesUnconfirmed"));await click("branchesCheckWrite")
   expect(postCalls()).toHaveLength(2);expect(postCalls()[1][1]!.body).toBe(body);expect(container.textContent).not.toContain("PRIVATE_NETWORK")
 })
 it("keeps an in-flight write stable during a language change",async()=>{
   const original=fetchMock.getMockImplementation()!;let resolve:(value:Response)=>void=()=>{}
   fetchMock.mockImplementation((url,options)=>options?.method==="POST"?new Promise<Response>(done=>{resolve=done}):original(url,options))
   await render();await newBranch();await submit();const signal=postCalls()[0][1]!.signal!;await render("en");expect(signal.aborted).toBe(false)
   await act(async()=>resolve(response({branch:{...fixture(),revisionId:NEXT},idempotent:false})));expect(container.textContent).toContain(t("branchesSaved"));expect(postCalls()).toHaveLength(1)
 })
 it("requires a fresh read after a stale-version response",async()=>{
   const original=fetchMock.getMockImplementation()!
   fetchMock.mockImplementation((url,options)=>options?.method==="POST"?Promise.resolve(response(null,409,"MTM_ATTENDANCE_BRANCH_CHANGED")):original(url,options))
   await render();await click("branchesEdit");await submit();expect(container.textContent).toContain(t("branchesChanged"));expect(button("branchesSave").disabled).toBe(true)
   await click("branchesRefresh");expect(container.querySelector('[data-testid="branches-editor"]')).toBeNull();expect(button("branchesAdd").disabled).toBe(false)
 })
 it.each([401,403,404])("clears registry, employees and pending payload on %s",async status=>{
   const original=fetchMock.getMockImplementation()!
   fetchMock.mockImplementation((url,options)=>options?.method==="POST"?Promise.resolve(response(null,status)):original(url,options))
   await render();await newBranch();await submit();expect(container.textContent).toContain(t("branchesAccessUnavailable"));expect(container.textContent).not.toMatch(/Fictional North|Demo Centre|Demo Street|Aylin/);expect(container.querySelector("input")).toBeNull();expect(button("branchesCheckWrite")).toBeUndefined()
 })
 it("clears a loaded registry when one refresh half refuses access",async()=>{
   await render();fetchMock.mockImplementation(async url=>String(url).includes("/assignments")?response(null,403):response(directory));await click("branchesRefresh");expect(container.textContent).not.toContain("Demo Centre");expect(container.textContent).toContain(t("branchesAccessUnavailable"))
 })
 it("has an honest empty state and bounded registry pages",async()=>{
   directory.branches=[];await render();expect(container.textContent).toContain(t("branchesEmpty"))
   directory.branches=Array.from({length:51},(_,index)=>({...fixture(),id:`fixture-${index}`,name:`Fictional branch ${index}`}));await click("branchesRefresh");expect(container.querySelectorAll('[data-testid="branch-row"]')).toHaveLength(25)
   await click("branchesNext");expect(container.textContent).toContain("Fictional branch 25");expect(container.querySelectorAll('[data-testid="branch-row"]')).toHaveLength(25)
 })
 it("does not replace an unavailable selected branch with unassigned",async()=>{
   assignments.employees[0].primary={revisionId:REV,version:1,branchId:NEXT,createdAt:"2026-10-13T08:00:00.000Z"};await render();await click("branchesAssignments")
   expect((container.querySelector("#primary-fictional-a") as HTMLSelectElement).value).toBe(NEXT);expect(container.textContent).toContain(t("branchesUnavailable"));expect(postCalls()).toHaveLength(0)
 })
 it("aborts reads and writes on unmount and ignores a late response",async()=>{
   const original=fetchMock.getMockImplementation()!;let resolve:(value:Response)=>void=()=>{}
   fetchMock.mockImplementation((url,options)=>options?.method==="POST"?new Promise<Response>(done=>{resolve=done}):original(url,options))
   await render();await newBranch();await submit();const calls=fetchMock.mock.calls.length;await act(async()=>root.unmount());unmounted=true
   expect(postCalls()[0][1]!.signal!.aborted).toBe(true);await act(async()=>resolve(response({branch:{...fixture(),revisionId:NEXT},idempotent:false})));expect(fetchMock.mock.calls).toHaveLength(calls)
 })
})
