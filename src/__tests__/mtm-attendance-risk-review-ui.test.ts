// @vitest-environment jsdom
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { createTranslator, NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MtmAttendanceRiskReview } from "@/components/mtm/attendance-risk-review"
import type { AttendanceRiskReport } from "@/lib/mtm/attendance-risk-contract"
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT=true
const messages=Object.fromEntries(["ru","az","en"].map(locale=>[locale,JSON.parse(readFileSync(`messages/${locale}.json`,"utf8"))]))
const CASE="10000000-0000-4000-8000-000000000001"
const fixture=():AttendanceRiskReport=>({directory:[{id:"fictional-employee",name:"Demo employee 01",teamId:"fictional-team",teamName:"Demo team"}],snapshot:{id:"a".repeat(64),asOf:"2026-10-13T06:00:00Z",query:{from:"2026-10-01",to:"2026-10-13",status:"ALL",kind:"ALL",teamId:"",employeeId:""}},items:[{id:CASE,employeeId:"fictional-employee",employeeName:"Demo employee 01",teamId:"fictional-team",teamName:"Demo team",kind:"SHARED_INSTALLATION",workDate:"2026-10-13",timezone:"Asia/Baku",claimedAt:"2026-10-13T05:00:00Z",serverReceivedAt:"2026-10-13T05:00:02Z",action:"START",createdAt:"2026-10-13T05:03:00Z",canDismiss:true,relatedNames:["Demo employee 02"],relatedNamesRestricted:false,usualName:"Demo employee 01",usualDays:8,observedDays:10,deltaSeconds:null,thresholdSeconds:null,branchName:null,distanceMeters:null,dismissal:null}]})
const response=(data:unknown,status=200)=>new Response(JSON.stringify({success:status<400,data,code:"PRIVATE_INTERNAL_TRACE"}),{status})
const fetchMock=vi.fn<typeof fetch>()
let root:Root,container:HTMLDivElement,report:AttendanceRiskReport,locale:"ru"|"az"|"en"
const t=(key:string)=>createTranslator({locale,messages:messages[locale],namespace:"mtmAttendance"})(key)
const buttons=(key:string)=>[...container.querySelectorAll<HTMLButtonElement>("button")].filter(b=>b.textContent===t(key))
const click=async(key:string,index=0)=>{await act(async()=>buttons(key)[index].click())}
async function render(language=locale){locale=language;const props={locale,messages:messages[locale],timeZone:"Asia/Baku",children:createElement(MtmAttendanceRiskReview)};await act(async()=>root.render(createElement(NextIntlClientProvider,props)))}
async function edit(id:string,value:string){await act(async()=>{const input=container.querySelector<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>(`#${id}`)!;const prototype=input.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:input.tagName==="SELECT"?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}))})}
const writes=()=>fetchMock.mock.calls.filter(([url,opts])=>String(url).endsWith(CASE)&&opts?.method==="POST")
async function submit(){await act(async()=>container.querySelector('[data-testid="risk-decision"] form')!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})))}
function capture(){const dir=process.env.MTM_ATTENDANCE_RENDER_DIR;if(!dir)return;mkdirSync(dir,{recursive:true});const clone=container.cloneNode(true) as HTMLElement;container.querySelectorAll("input").forEach((field,i)=>clone.querySelectorAll("input")[i].setAttribute("value",field.value));container.querySelectorAll("textarea").forEach((field,i)=>clone.querySelectorAll("textarea")[i].textContent=field.value);container.querySelectorAll("select").forEach((field,i)=>[...clone.querySelectorAll("select")[i].options].forEach(option=>{if(option.value===field.value)option.setAttribute("selected","");else option.removeAttribute("selected")}));writeFileSync(join(dir,`attendance-risk-review-${locale}.html`),`<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="attendance.css"></head><body><main style="max-width:1400px;margin:auto;padding:24px">${clone.innerHTML}</main></body></html>`)}
beforeEach(()=>{locale="ru";report=fixture();container=document.createElement("div");document.body.append(container);root=createRoot(container);fetchMock.mockReset();vi.stubGlobal("fetch",fetchMock);fetchMock.mockImplementation(async(url,opts)=>opts?.method==="POST"?response({id:CASE}):response(report))})
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals()})
describe("risk review screen",()=>{
 it.each(["ru","az","en"] as const)("renders localized safe rows and reason form in %s",async language=>{
  report.items.push({...report.items[0],id:"another-case",employeeName:"Demo employee 03",kind:"DELAYED_CLAIM",serverReceivedAt:"2026-10-13T07:25:00Z",deltaSeconds:8700,relatedNames:[],usualName:null,dismissal:{at:"2026-10-13T08:00:00Z",byName:"Demo reviewer",reason:"Demo: connection restored"},canDismiss:false})
  await render(language);await click("riskReview");expect(container.textContent).toContain(t("riskSharedInstallation"));expect(container.textContent).toContain(t("riskReasonHint"));expect(container.textContent).toContain("Demo: connection restored");expect(buttons("riskDismiss")[0].disabled).toBe(true);expect(container.querySelectorAll('[data-testid="risk-row"]')).toHaveLength(2);capture()
 })
 it("freezes an unknown decision and retries exactly the same request",async()=>{
  fetchMock.mockImplementation(async(url,opts)=>{if(String(url).endsWith(CASE)&&opts?.method==="POST"){if(writes().length===1)throw new Error("lost reply");report.items[0].dismissal={at:"2026-10-13T06:00:00Z",byName:"Demo reviewer",reason:"Demo shared device"};report.items[0].canDismiss=false;return response({id:CASE,idempotent:true})}return response(report)})
  await render();await click("riskReview");await edit("risk-reason","Demo shared device");await submit()
  expect(container.textContent).toContain(t("riskUnknown"));expect((container.querySelector("#risk-reason") as HTMLTextAreaElement).disabled).toBe(true);expect(buttons("journalApply")[0].disabled).toBe(true)
  await click("riskRetry");expect(writes()).toHaveLength(2);expect(writes()[0][1]?.body).toBe(writes()[1][1]?.body);expect(container.textContent).toContain(t("riskSaved"));expect(container.textContent).toContain("Demo reviewer")
 })
 it.each([401,403,404])("clears private data and pending decision on %s",async status=>{
  fetchMock.mockImplementation(async(url,opts)=>opts?.method==="POST"?response(null,status):response(report))
  await render();await click("riskReview");await edit("risk-reason","Demo reviewed");await submit();expect(container.textContent).toContain(t("reportAccessUnavailable"));expect(container.textContent).not.toMatch(/Demo employee|Demo team|Demo reviewed|PRIVATE_INTERNAL/);expect(container.querySelector("textarea")).toBeNull()
 })
 it("does not offer dismissal to a read-only reviewer",async()=>{report.items[0].canDismiss=false;await render();await click("riskReview");expect(container.textContent).toContain(t("riskReadOnly"));expect(container.querySelector("textarea")).toBeNull()})
 it("prevents stale decision retry and exports until data is refreshed",async()=>{
  fetchMock.mockImplementation(async(url,opts)=>opts?.method==="POST"?response(null,409):response(report))
  await render();await click("riskReview");await edit("risk-reason","Demo reason");await submit();expect(container.textContent).toContain(t("riskChanged"));expect(buttons("riskDismiss")[0].disabled).toBe(true);expect(buttons("exportPdf")[0].disabled).toBe(true);expect(buttons("riskRetry")).toHaveLength(0)
 })
 it("requires applied filters before exporting",async()=>{await render();expect(buttons("exportPdf")[0].disabled).toBe(false);await edit("risk-from","2026-10-02");expect(buttons("exportPdf")[0].disabled).toBe(true);expect(container.textContent).toContain(t("journalDraftHint"))})
 it("renders a truthful empty state",async()=>{report.items=[];await render();expect(container.textContent).toContain(t("riskEmpty"));expect(container.querySelector("table")).toBeNull()})
 it("aborts an in-flight read on unmount",async()=>{fetchMock.mockImplementation(()=>new Promise(()=>{}));await render();const signal=fetchMock.mock.calls[0][1]?.signal;await act(async()=>root.unmount());expect(signal?.aborted).toBe(true);root=createRoot(container)})
})
