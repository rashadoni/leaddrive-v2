import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { emitRemote, requireSha } from './inspect-production.mjs';

const counts=['hostCount','selectedAccountCount','standaloneCount','ssoCount','noAccountCount','missingAccessTokenCount','expiredCount','expiredWithoutRefreshCount','refreshPresentCount','unknownScopeCount','missingFreeBusyScopeCount'];
const booleans=['pageFound','appAccountSelectAllowed','accountRlsEnabled','accountRlsForced','clientIdConfigured','clientSecretConfigured','readOnly','rlsUnfiltered'];
export function emitCalendarRemote(sha,slug) {
 requireSha(sha);
 if (!/^[a-z0-9-]{1,60}$/.test(slug??'')) throw Error('INVALID_SLUG');
 const oldSql=readFileSync(new URL('./inspect-production.sql',import.meta.url),'utf8');
 let sql=readFileSync(new URL('./inspect-calendar.sql',import.meta.url),'utf8')
  .replace('BOOKING_DIAGNOSTIC_SLUG',slug)
  .replace('GOOGLE_CLIENT_ID_PRESENT','${booking_calendar_client_id_present}')
  .replace('GOOGLE_CLIENT_SECRET_PRESENT','${booking_calendar_client_secret_present}');
 const base=emitRemote(sha);
 if (base.split(oldSql).length!==2) throw Error('INSPECTOR_CONTRACT_CHANGED');
 return base.replace(oldSql,sql).replace("<<'BOOKING_READONLY_SQL'",'<<BOOKING_READONLY_SQL')
  .replace('run_readonly_psql "$booking_inspection_url"',`require_root_file /etc/leaddrive/app.env 600 || exit 1
booking_calendar_client_id_present=false
booking_calendar_client_secret_present=false
if read_static_env_value /etc/leaddrive/app.env GOOGLE_CLIENT_ID >/dev/null; then booking_calendar_client_id_present=true; fi
if read_static_env_value /etc/leaddrive/app.env GOOGLE_CLIENT_SECRET >/dev/null; then booking_calendar_client_secret_present=true; fi
run_readonly_psql "$booking_inspection_url"`);
}
export function sanitizeCalendar(raw,sourceSha,artifactSha,exit) {
 requireSha(sourceSha);requireSha(artifactSha);
 const error={version:1,status:'ERROR',sourceSha,artifactSha,productionObserved:false,code:'CALENDAR_INSPECTION_INVALID'};
 if(exit!==0||Buffer.byteLength(raw)>4096)return error;
 let value;try{value=JSON.parse(raw);}catch{return error;}
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==counts.length+booleans.length||counts.some(k=>!Number.isSafeInteger(value[k])||value[k]<0)||booleans.some(k=>typeof value[k]!=='boolean')||!value.readOnly||!value.rlsUnfiltered)return error;
 return {version:1,status:'PASS_CALENDAR_INVENTORY_ONLY',sourceSha,artifactSha,productionObserved:true,observedAt:new Date().toISOString(),inventory:Object.fromEntries([...counts,...booleans].map(k=>[k,value[k]]))};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 const [mode,source,artifact,arg]=args;
 try{
  if(mode==='--emit-remote'&&args.length===3)process.stdout.write(emitCalendarRemote(source,artifact));
  else if(mode==='--validate-output'&&args.length===4&&/^\d+$/.test(arg??'')){
   const result=sanitizeCalendar(readFileSync(0,'utf8'),source,artifact,Number(arg));
   process.stdout.write(JSON.stringify(result)+'\n');if(result.status==='ERROR')process.exitCode=1;
  }else throw Error('INVALID_ARGUMENTS');
 }catch{process.stderr.write('CALENDAR_INSPECTION_INVALID\n');process.exitCode=1;}
}
