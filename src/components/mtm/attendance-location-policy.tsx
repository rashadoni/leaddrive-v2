"use client"

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { useTranslations } from "next-intl"
import { FileText, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { HomeCard, HomePill } from "@/components/mtm/home-parts"
import { AttendanceLocationPolicyInputSchema, type AttendanceLocationPolicy } from "@/lib/mtm/attendance-location-contract"
import { attendanceConsentTemplate } from "@/lib/mtm/attendance-consent-template"

const ENDPOINT="/api/v1/mtm/attendance/location-policy"
const LANGUAGES=["az","ru","en"] as const
const empty=()=>({texts:{az:"",ru:"",en:""},enabled:false,legalReviewConfirmed:false})
type Publication=ReturnType<typeof AttendanceLocationPolicyInputSchema.parse>
function isPolicy(value:unknown):value is AttendanceLocationPolicy {
  if (!value||typeof value!=="object")return false
  const row=value as AttendanceLocationPolicy
  return typeof row.id==="string"&&row.id.length>0&&Number.isInteger(row.version)&&row.version>0&&typeof row.enabled==="boolean"&&typeof row.legalReviewConfirmed==="boolean"
    &&typeof row.createdAt==="string"&&Number.isFinite(Date.parse(row.createdAt))&&LANGUAGES.every(lang=>typeof row.texts?.[lang]==="string")
}
export function MtmAttendanceLocationPolicy(){
 const t=useTranslations("mtmAttendance")
 const[policy,setPolicy]=useState<AttendanceLocationPolicy|null|undefined>(),[draft,setDraft]=useState(empty)
 const[loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[denied,setDenied]=useState(false),[refreshRequired,setRefreshRequired]=useState(false)
 const[error,setError]=useState<string|null>(null),[saved,setSaved]=useState(false),[pending,setPending]=useState<Publication|null>(null)
 // An empty agreement starts from the draft (owner, 2026-10-30); employees see nothing until it is published.
 const[prefilled,setPrefilled]=useState(false)
 const read=useRef<AbortController|null>(null),write=useRef<AbortController|null>(null),pendingRef=useRef<Publication|null>(null)
 const fields=useRef<Partial<Record<typeof LANGUAGES[number],HTMLTextAreaElement|null>>>({})
 const clear=useCallback(()=>{setPolicy(undefined);setDraft(empty());setSaved(false);setPending(null);pendingRef.current=null;setRefreshRequired(false)},[])
 const load=useCallback(async()=>{
  if(pendingRef.current)return false
  read.current?.abort();const controller=new AbortController();read.current=controller
  setLoading(true);setPolicy(undefined);setError(null);setSaved(false)
  try{
   const response=await fetch(ENDPOINT,{cache:"no-store",signal:controller.signal}),body=await response.json().catch(()=>null)
   if(controller.signal.aborted)return false
   if([401,403,404].includes(response.status)){clear();setDenied(true);setError("geoPolicyAccessUnavailable");return false}
   if(!response.ok||body?.success!==true||(body.data?.policy!==null&&!isPolicy(body.data?.policy))){setError("geoPolicyLoadError");return false}
   const current:AttendanceLocationPolicy|null=body.data.policy
   const template=attendanceConsentTemplate(typeof body.data.organizationName==="string"?body.data.organizationName:null)
   const missing=LANGUAGES.filter(lang=>!current?.texts[lang].trim())
   const texts=Object.fromEntries(LANGUAGES.map(lang=>[lang,missing.includes(lang)?template[lang]:current!.texts[lang]])) as Record<typeof LANGUAGES[number],string>
   setPolicy(current);setPrefilled(missing.length>0)
   setDraft(current?{texts,enabled:current.enabled&&!missing.length,legalReviewConfirmed:current.legalReviewConfirmed&&!missing.length}:{...empty(),texts});setRefreshRequired(false);return true
  }catch{if(!controller.signal.aborted)setError("geoPolicyLoadError");return false}
  finally{if(!controller.signal.aborted)setLoading(false)}
 },[clear])
 useEffect(()=>{void load();return()=>{read.current?.abort();write.current?.abort();pendingRef.current=null}},[load])
 useEffect(()=>{for(const field of Object.values(fields.current)){if(field){field.style.height="auto";field.style.height=`${Math.max(144,field.scrollHeight)}px`}}},[draft.texts,policy])
 async function publish(body:Publication){
  if(write.current||loading||denied)return
  const controller=new AbortController();write.current=controller;pendingRef.current=body;setPending(body);setSaving(true);setError(null);setSaved(false)
  try{
   const response=await fetch(ENDPOINT,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),signal:controller.signal}),result=await response.json().catch(()=>null)
   if(controller.signal.aborted)return
   if([401,403,404].includes(response.status)){clear();setDenied(true);setError("geoPolicyAccessUnavailable");return}
   if(response.ok&&result?.success===true&&isPolicy(result.data?.policy)&&typeof result.data.idempotent==="boolean"){
    pendingRef.current=null;setPending(null);if(await load())setSaved(true);return
   }
   if([400,409,413,422].includes(response.status)){
    pendingRef.current=null;setPending(null);setError(response.status===409?"geoPolicyChanged":"geoPolicyInvalid");if(response.status===409)setRefreshRequired(true)
   }else setError("geoPolicyUnconfirmed")
  }catch{if(!controller.signal.aborted)setError("geoPolicyUnconfirmed")}
  finally{if(write.current===controller)write.current=null;if(!controller.signal.aborted)setSaving(false)}
 }
 function submit(event:FormEvent){
  event.preventDefault();if(blocked)return
  const parsed=AttendanceLocationPolicyInputSchema.safeParse({requestId:crypto.randomUUID(),expectedRevisionId:policy?.id??null,...draft})
  if(!parsed.success){setError("geoPolicyInvalid");return}void publish(parsed.data)
 }
 const blocked=loading||saving||Boolean(pending)||refreshRequired||denied||policy===undefined
 const ready=draft.legalReviewConfirmed&&LANGUAGES.every(lang=>draft.texts[lang].trim().length>=20)
 return <div className="mx-auto grid w-full max-w-5xl min-w-0 gap-6" data-testid="attendance-location-policy">
  <header className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><p className="text-sm text-muted-foreground">{t("geoPolicyEyebrow")}</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">{t("geoPolicyTitle")}</h1><p className="mt-2 max-w-prose text-sm text-muted-foreground">{t("geoPolicySubtitle")}</p></div></header>
  {loading&&<p role="status" className="text-sm text-muted-foreground">{t("geoPolicyLoading")}</p>}
  {error&&<div role="alert" className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4"><p className="text-sm">{t(error)}</p>{pending?<Button className="min-h-11" variant="outline" disabled={saving} onClick={()=>void publish(pending)}>{t("geoPolicyRetry")}</Button>:!denied&&<Button className="min-h-11" variant="outline" disabled={loading||saving} onClick={()=>void load()}>{t("geoPolicyRefresh")}</Button>}</div>}
  {saved&&<p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{t("geoPolicySaved")}</p>}
  {policy!==undefined&&!denied&&<form className="grid min-w-0 gap-6" onSubmit={submit} aria-label={t("geoPolicyTitle")}>
  <HomeCard testId="geo-policy-status" titleId="geo-policy-status-title" title={t("geoPolicyModeTitle")} icon={<ShieldCheck className="h-4 w-4" aria-hidden="true"/>} tone="orange"><fieldset className="space-y-3 py-4" disabled={blocked}><legend className="sr-only">{t("geoPolicyModeTitle")}</legend>
   {/* One setting, two ways (owner, 2026-10-30): some organizations take no place of a phone at all. */}
   <label className={`flex cursor-pointer gap-3 rounded-xl border p-4 ${!draft.enabled?"border-primary":""}`}><input type="radio" name="geo-mode" className="mt-1 h-5 w-5 shrink-0 accent-primary" checked={!draft.enabled} onChange={()=>setDraft(current=>({...current,enabled:false}))}/><span className="min-w-0 space-y-1"><span className="block font-medium">{t("geoPolicyModeQr")}</span><span className="block text-sm text-muted-foreground">{t("geoPolicyModeQrHint")}</span></span></label>
   <label className={`flex gap-3 rounded-xl border p-4 ${draft.enabled?"border-primary":""} ${ready?"cursor-pointer":"opacity-80"}`}><input type="radio" name="geo-mode" className="mt-1 h-5 w-5 shrink-0 accent-primary" disabled={blocked||!ready} checked={draft.enabled} onChange={()=>setDraft(current=>({...current,enabled:true}))}/><span className="min-w-0 space-y-1"><span className="flex flex-wrap items-center gap-2 font-medium">{t("geoPolicyEnable")}<HomePill tone="green">{t("geoPolicyModeSafer")}</HomePill></span><span className="block text-sm text-muted-foreground">{t("geoPolicyModeDoubleHint")}</span>{!ready&&<span className="block text-sm text-amber-700 dark:text-amber-400">{t("geoPolicyModeNeedsAgreement")}</span>}</span></label>
   <p className="max-w-prose text-sm text-muted-foreground">{t("geoPolicyPrivacy")}</p>
  </fieldset></HomeCard>
  <HomeCard testId="geo-policy-editor" titleId="geo-policy-editor-title" title={t("geoPolicyTextTitle")} icon={<FileText className="h-4 w-4" aria-hidden="true"/>} tone="orange"><div className="space-y-6 py-4">
   <div className="flex flex-wrap items-center gap-3"><HomePill tone={policy?.enabled?"green":"amber"}>{t(policy?.enabled?"geoPolicyAgreementLive":"geoPolicyAgreementDraft")}</HomePill>{prefilled&&<span className="text-sm text-muted-foreground">{t("geoPolicyAgreementPrefilled")}</span>}</div>
   {LANGUAGES.map(lang=><div key={lang} className="min-w-0 space-y-2"><label className="text-sm font-medium" htmlFor={`geo-text-${lang}`}>{t(`geoPolicyLanguage_${lang}`)}</label><textarea ref={node=>{fields.current[lang]=node}} id={`geo-text-${lang}`} className="min-h-36 w-full resize-none overflow-hidden rounded-md border border-input bg-background p-3 text-sm leading-relaxed" maxLength={8000} rows={5} disabled={blocked} value={draft.texts[lang]} placeholder={t("geoPolicyTextPlaceholder")} onChange={event=>setDraft(current=>({...current,texts:{...current.texts,[lang]:event.target.value},legalReviewConfirmed:false,enabled:false}))}/></div>)}
   <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 shrink-0 accent-primary" disabled={blocked} checked={draft.legalReviewConfirmed} onChange={event=>setDraft(current=>({...current,legalReviewConfirmed:event.target.checked,...(!event.target.checked?{enabled:false}:{})}))}/>{t("geoPolicyLegalConfirmed")}</label>
   <p className="max-w-prose text-sm text-muted-foreground">{t("geoPolicyReconsent")}</p><Button type="submit" className="min-h-11" disabled={blocked}>{t(saving?"geoPolicySaving":"geoPolicySave")}</Button>
  </div></HomeCard></form>}
 </div>
}
