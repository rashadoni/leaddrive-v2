// @vitest-environment jsdom
import { readFileSync,mkdirSync,writeFileSync } from "node:fs"
import { join } from "node:path"
import { act,createElement } from "react"
import { createRoot,type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach,afterEach,describe,it,expect,vi } from "vitest"
import { MtmAttendanceMonths } from "@/components/mtm/attendance-months"
import type { AttendanceMonthDetail,AttendanceMonthDirectory,AttendanceMonthPreview } from "@/lib/mtm/attendance-month-contract"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
const messages=Object.fromEntries(["ru","en","az"].map(lang=>[lang,JSON.parse(readFileSync(`messages/${lang}.json`,"utf8"))])),t=messages.ru.mtmAttendance,id="00000000-0000-4000-8000-000000000010"
let root:Root,host:HTMLDivElement,dir:AttendanceMonthDirectory,detail:AttendanceMonthDetail,preview:AttendanceMonthPreview
const fetchMock=vi.fn<typeof fetch>(),response=(data:unknown,status=200)=>new Response(JSON.stringify({success:status<400,data}),{status})
beforeEach(()=>{host=document.createElement("div");document.body.append(host);root=createRoot(host)
 dir={month:"2026-09",canClose:true,moreEmployees:false,moreSnapshots:false,employees:[{id:"fictional-a",name:"Demo employee 01",teamName:"Demo team",canClose:true,closed:false}],items:[{id,month:"2026-09",createdAt:"2026-10-01T07:25:00Z",createdByName:"Demo reviewer",employeeCount:1}]}
 detail={...dir.items[0],table:{title:"September 2026",columns:[{key:"employee",label:"Employee"},...Array.from({length:30},(_,i)=>({key:`2026-09-${String(i+1).padStart(2,"0")}`,label:String(i+1)})),{key:"worked",label:"Hours"}],rows:[{key:"fictional-a",cells:["Demo employee 01",...Array.from({length:30},(_,i)=>[5,6,12,13,19,20,26,27].includes(i+1)?"—":i===27?"7:50":"8:00"),"175:50"]}],details:["Frozen original timesheet"],totals:["175:50"]},moreCorrections:false,corrections:[{id:"correction",employeeId:"fictional-a",employeeName:"Demo employee 01",date:"2026-09-28",at:"2026-10-03T06:40:00Z",reviewerName:"Demo reviewer",requestId:id,before:{startedAt:"2026-09-28T05:10:00Z",completedAt:"2026-09-28T14:00:00Z"},after:{startedAt:"2026-09-28T05:00:00Z",completedAt:"2026-09-28T14:00:00Z"}}]}
 preview={month:"2026-09",agentIds:["fictional-a"],hash:"a".repeat(64),asOf:"2026-10-13T08:00:00Z",table:detail.table,blockers:[]}
 fetchMock.mockReset();vi.stubGlobal("fetch",fetchMock);fetchMock.mockImplementation(async(url,options)=>String(url).includes("/preview")?response(preview):options?.method==="POST"?response({id}):String(url).includes(`/${id}`)?response(detail):response(dir))
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();vi.restoreAllMocks()})
async function render(locale="ru"){detail.table.columns[0].label=messages[locale].mtmAttendance.reportEmployee;detail.table.columns.at(-1)!.label=messages[locale].mtmAttendance.reportWorked;detail.table.details=[messages[locale].mtmAttendance.reportMonth+": 09.2026"];const props={locale,messages:messages[locale],timeZone:"Asia/Baku",children:createElement(MtmAttendanceMonths)};await act(async()=>root.render(createElement(NextIntlClientProvider,props)))}
function button(label:string){return [...host.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent===label)!}
async function open(){const select=host.querySelector<HTMLSelectElement>("select")!;await act(async()=>{select.value=id;select.dispatchEvent(new Event("change",{bubbles:true}))})}
async function prepare(){await act(async()=>button(t.monthCloseSelectAvailable).click());await act(async()=>host.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})))}
async function confirm(){await act(async()=>{const inputs=[...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];inputs.at(-1)!.click()});await act(async()=>button(t.monthCloseAction).click())}
describe("immutable month UI",()=>{
 it.each(["ru","az","en"])("shows the saved %s table and a separate safe correction journal",async locale=>{await render(locale);await open();expect(host.textContent).toContain("175:50");expect(host.textContent).toContain(messages[locale].mtmAttendance.monthCloseReasonInRequest);expect(host.textContent).not.toContain("mtmAttendance.");expect(host.querySelector(`a[href*="requestId=${id}"]`)).not.toBeNull()
  const out=process.env.MTM_ATTENDANCE_RENDER_DIR;if(out){mkdirSync(out,{recursive:true});const clone=host.cloneNode(true) as HTMLElement;host.querySelectorAll("select").forEach((select,index)=>{for(const option of clone.querySelectorAll("select")[index].options){if(option.value===select.value)option.setAttribute("selected","")}});writeFileSync(join(out,`attendance-month-${locale}.html`),`<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="attendance.css"></head><body>${clone.innerHTML}</body></html>`)}
 })
 it("keeps read-only HR out of closure controls",async()=>{dir.canClose=false;await render();expect(host.querySelector("form")).toBeNull();await open();expect(button(t.monthCloseExcel)).toBeDefined()})
 it("does not close an unfinished period or close without explicit preview confirmation",async()=>{preview.blockers=[{employeeId:"fictional-a",date:"2026-09-01",kind:"MISSING_FINISH"}];await render();await prepare();expect(host.textContent).toContain(t.monthCloseBlocked);expect(button(t.monthCloseAction)).toBeUndefined();expect(fetchMock.mock.calls.filter(([url,options])=>url===endpoint&&options?.method==="POST")).toHaveLength(0)})
 it("retries an unknown closure using exactly the original UUID/body",async()=>{await render();await prepare();expect(button(t.monthCloseAction).disabled).toBe(true);fetchMock.mockImplementation(async(url,options)=>options?.method==="POST"?Promise.reject(new Error("response lost")):response(dir));await confirm();expect(host.textContent).toContain(t.monthCloseUnknown)
  expect(host.querySelector<HTMLInputElement>('input[type="month"]')!.disabled).toBe(true);await act(async()=>button(t.monthCloseRetry).click());const calls=fetchMock.mock.calls.filter(([url,options])=>url===endpoint&&options?.method==="POST");expect(calls).toHaveLength(2);expect(calls[0][1]?.body).toBe(calls[1][1]?.body)
 })
 it("erases frozen employee data when a fresh read denies access",async()=>{await render();await open();fetchMock.mockResolvedValue(response(null,403));await act(async()=>button(t.monthCloseExcel).click());expect(host.textContent).not.toContain("Demo employee 01");expect(host.textContent).toContain(t.reportAccessUnavailable)})
 it("returns to preview after an explicit changed or oversized refusal",async()=>{await render();await prepare();fetchMock.mockResolvedValue(new Response(JSON.stringify({code:"MTM_ATTENDANCE_MONTH_CHANGED"}),{status:409}));await confirm();expect(host.textContent).toContain(t.monthCloseChanged);expect(button(t.monthCloseRetry)).toBeUndefined();expect(host.querySelector<HTMLInputElement>('input[type="month"]')!.disabled).toBe(false)})
})
const endpoint="/api/v1/mtm/attendance/months"
