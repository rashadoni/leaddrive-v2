import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { chromium } from 'playwright'

assert.equal(process.env.WF_BULK_TEST,'1')
assert.notEqual(process.env.NODE_ENV,'production')
const origin=new URL(process.env.WF_BULK_BASE_URL)
assert.equal(origin.protocol,'http:');assert.ok(['localhost','127.0.0.1'].includes(origin.hostname));assert.equal(origin.pathname,'/')
const database=new URL(process.env.ADMIN_DATABASE_URL)
assert.equal(database.hostname,'127.0.0.1');assert.equal(database.pathname,'/workforce_bulk_browser');assert.equal(database.username,'postgres')
const output=process.env.WF_BULK_OUTPUT||'artifacts/workforce-bulk-browser';await mkdir(output,{recursive:true})
const receipt={version:1,status:'RUNNING',head:process.env.WF_BULK_HEAD_SHA||null,merge:process.env.GITHUB_SHA||null,environment:process.env.GITHUB_ACTIONS==='true'?'GitHub Linux isolated PostgreSQL/Next/Chromium':'workspace isolated PostgreSQL/Next/Chromium',cases:[],auth:[],sourceBindings:[],limitations:['No production business data or activation','No physical Android, human AT, whole-HRM or full historical migration acceptance','No screenshots or raw server logs in evidence']}
const paths=['.github/workflows/workforce-bulk-assignment-evidence.yml','scripts/ci/fixtures/workforce-native-zoom-extension/manifest.json','scripts/ci/fixtures/workforce-native-zoom-extension/background.js','scripts/workforce-bulk-browser-evidence.mjs','scripts/workforce-bulk-fixture.mjs','src/components/workforce/workforce-configuration-workbench.tsx','src/lib/workforce/configuration-management.ts','src/lib/workforce/site-management.ts','src/lib/with-workforce-rls-auth.ts','src/lib/with-rls.ts','src/lib/auth.ts','src/lib/api-auth.ts','src/lib/prisma.ts','src/proxy.ts','prisma/schema.prisma','messages/en.json','messages/ru.json','messages/az.json','prisma/migrations/20261006150000_workforce_transferred_assignment_window/migration.sql',...['assignments','site-assignments'].flatMap(p=>['route.ts','preview/route.ts','bulk/publish/route.ts'].map(r=>`src/app/api/v1/workforce/configuration/${p}/${r}`))]
for(const path of paths){const bytes=await readFile(path);receipt.sourceBindings.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')})}
const admin=new PrismaClient({datasourceUrl:database.toString()})
const contexts=[];const releases=[];let activePage;let browser;let native;let phase='setup';const events=[]
const record=(name,details={})=>{receipt.cases.push({name,status:'PASS',...details});console.log(JSON.stringify({case:name,status:'PASS'}))}
const authTimes=[]
const definition={startTime:'09:00',endTime:'18:00',timezone:'Asia/Baku',daysOfWeek:[1,2,3,4,5]}
const definitionHash=createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(definition).sort(([a],[b])=>a.localeCompare(b))))).digest('hex')
const password=`Fixture-${randomUUID()}-9!`;const suffix=randomUUID().slice(0,8)
async function auth(context,principal){
 while(authTimes.length&&Date.now()-authTimes[0]>61_000)authTimes.shift()
 if(authTimes.length>=8)await new Promise(r=>setTimeout(r,61_050-(Date.now()-authTimes[0])))
 const csrf=await context.request.get('/api/auth/csrf',{timeout:120_000});assert.equal(csrf.status(),200);const token=(await csrf.json()).csrfToken;authTimes.push(Date.now())
 const result=await context.request.post('/api/auth/callback/credentials',{timeout:120_000,headers:{'X-Auth-Return-Redirect':'1'},form:{csrfToken:token,email:principal.email,password,organizationSlug:principal.slug,callbackUrl:origin.origin+'/workforce/configuration'}})
 assert.equal(result.status(),200,'credentials callback');const redir=new URL((await result.json()).url,origin.origin);assert.equal(redir.searchParams.get('error'),null,'credentials result');const session=await (await context.request.get('/api/auth/session',{timeout:120_000})).json();assert.equal(session.user.id,principal.id);assert.equal(session.user.organizationId,principal.organizationId);receipt.auth.push({csrf:200,callback:200,sessionBound:true})
}
async function open(principal,locale='en',viewport={width:1440,height:1000},context){
 context ||= await browser.newContext({baseURL:origin.origin,viewport,serviceWorkers:'block'});contexts.push(context);await context.addCookies([{name:'NEXT_LOCALE',value:locale,url:origin.origin}]);await auth(context,principal);const page=await context.newPage();activePage=page;page.on('pageerror',error=>events.push('pageerror:'+error.name+':'+(error.message.includes('Minified React')?'react':error.message.includes('Invalid URL')?'url':error.message.includes('not defined')?'undefined':error.message.includes('Cannot read')?'property':'other')));page.setDefaultTimeout(30_000);page.setDefaultNavigationTimeout(120_000);phase='open-page-'+locale;await page.goto('/workforce/configuration',{waitUntil:'domcontentloaded'});phase='open-controls-'+locale;await page.locator('#workforce-bulk-assignment-template').waitFor();const ui=JSON.parse(await readFile(`messages/${locale}.json`,'utf8')).workforceConfigurationPage;return {page,context,ui,locale,principal}
}
function surface(view,kind){const site=kind==='site';const prefix=site?'workforce-bulk-site-assignment':'workforce-bulk-assignment';return {form:view.page.locator(`form[aria-labelledby="${prefix}-preview-title"]`),prefix,endpoint:`/api/v1/workforce/configuration/${site?'site-assignments':'assignments'}`,target:site?'site':'template',review:view.ui[site?'reviewBulkSiteAssignmentDraft':'reviewBulkAssignmentDraft'],publish:view.ui[site?'publishBulkSiteAssignment':'publishBulkAssignment']}}
const future=(offset)=>{const d=new Date();d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10)}
async function prepare(view,kind,pair,target,offset=14){const f=surface(view,kind);await f.form.locator(`#${f.prefix}-${f.target}`).selectOption(target);await f.form.locator(`#${f.prefix}-effective-from`).fill(future(offset));for(const employee of pair)await f.form.locator(`#${f.prefix}-employee-${employee.id}`).check();return f}
async function preview(view,f){const res=view.page.waitForResponse(r=>r.url().endsWith(f.endpoint+'/preview')&&r.request().method()==='POST');await f.form.getByRole('button',{name:f.review,exact:true}).click();const response=await res;assert.equal(response.status(),200);const payload=await response.json();assert.equal(payload.success,true);return payload.data}
async function confirm(view,f){await f.form.locator(`#${f.prefix}-publish-confirm`).check();const result=view.page.waitForResponse(r=>r.url().endsWith(f.endpoint+'/bulk/publish'));await f.form.getByRole('button',{name:f.publish,exact:true}).click();return result}
function latch(){let release;const promise=new Promise(r=>{release=r});releases.push(release);return {promise,release}}
async function wait(test){const end=Date.now()+30_000;while(Date.now()<end){if(await test())return;await new Promise(r=>setTimeout(r,50))}throw new Error('bounded condition timed out')}
async function total(org,kind){return kind==='shift'?admin.workforceShiftAssignmentBulkOperation.count({where:{organizationId:org}}):admin.workforceSiteAssignmentBulkOperation.count({where:{organizationId:org}})}
async function standard(view,kind,pair,target){
 const f=await prepare(view,kind,pair,target);const before=await total(view.principal.organizationId,kind);const p=await preview(view,f);assert.equal(p.summary.READY,2);assert.equal(await f.form.locator('[role="status"]').count(),1);const live=await f.form.locator('[role="status"]').innerText();assert.ok(pair.every(e=>!live.includes(e.name)),'aggregate live region');assert.equal(await f.form.getByRole('button',{name:f.publish,exact:true}).isDisabled(),true)
 await f.form.getByRole('button',{name:view.ui.discardBulkAssignmentDraft,exact:true}).click();assert.equal(await f.form.locator(`#${f.prefix}-effective-from`).inputValue(),'');assert.equal(await total(view.principal.organizationId,kind),before)
 await prepare(view,kind,pair,target);await preview(view,f);const response=await confirm(view,f);assert.equal(response.status(),201);assert.equal((await response.json()).data.operation.createdCount,2);await wait(async()=>await f.form.locator(`#${f.prefix}-effective-from`).inputValue()==='');assert.equal(await total(view.principal.organizationId,kind),before+1)
 await prepare(view,kind,pair,target,15);const unchanged=await preview(view,f);assert.equal(unchanged.summary.NO_CHANGE,2);assert.equal(await f.form.locator(`#${f.prefix}-publish-confirm`).count(),0);await f.form.getByRole('button',{name:view.ui.discardBulkAssignmentDraft,exact:true}).click();record(`${view.locale}-${kind}-named-preview-discard-publish-no-change`,{people:2,created:2,receipts:1,aggregateLiveRegion:true})
}
async function stale(view,kind,pair,target){const f=await prepare(view,kind,pair,target);const gate=latch();let held=false;await view.page.route('**'+f.endpoint+'/preview',async route=>{const res=await route.fetch();held=true;await gate.promise;await route.fulfill({response:res})});await f.form.getByRole('button',{name:f.review,exact:true}).click();await wait(()=>held);await f.form.locator(`#${f.prefix}-effective-from`).fill(future(16));gate.release();await wait(async()=>!await f.form.getByRole('button',{name:f.review,exact:true}).isDisabled());assert.equal(await f.form.locator(`#${f.prefix}-publish-confirm`).count(),0);await view.page.unroute('**'+f.endpoint+'/preview');await f.form.getByRole('button',{name:view.ui.discardBulkAssignmentDraft,exact:true}).click();record(`${kind}-held-old-preview-cannot-confirm-edited-draft`)}
async function lost(view,kind,pair,target){const f=await prepare(view,kind,pair,target);await preview(view,f);const requests=[];let first=true;await view.page.route('**'+f.endpoint+'/bulk/publish',async route=>{requests.push(route.request().postData());const res=await route.fetch();if(first){first=false;assert.equal(res.status(),201);await route.abort('failed')}else{assert.equal(res.status(),200);await route.fulfill({response:res})}});await f.form.locator(`#${f.prefix}-publish-confirm`).check();await f.form.getByRole('button',{name:f.publish,exact:true}).click();await f.form.getByText(view.ui.bulkPublishOutcomeUnknown,{exact:true}).waitFor();assert.equal(await f.form.getByRole('button',{name:f.review,exact:true}).isDisabled(),true);await f.form.getByRole('button',{name:f.publish,exact:true}).click();await wait(async()=>await f.form.locator(`#${f.prefix}-effective-from`).inputValue()==='');assert.equal(requests.length,2);assert.equal(requests[0],requests[1]);await view.page.unroute('**'+f.endpoint+'/bulk/publish');record(`${kind}-lost-actual201-exact200-retry`,{sameRequest:true,writesOnce:true})}
async function geometry(view,kind,pair,target){const f=await prepare(view,kind,pair,target);await preview(view,f);const confirm=f.form.locator(`#${f.prefix}-publish-confirm`);await confirm.focus();await view.page.keyboard.press('Space');await view.page.keyboard.press('Tab');const button=f.form.getByRole('button',{name:f.publish,exact:true});const g=await button.evaluate(el=>{const r=el.getBoundingClientRect();const m=el.closest('main').getBoundingClientRect();return {focused:document.activeElement===el,focusVisible:el.matches(':focus-visible'),left:r.left,right:r.right,top:r.top,bottom:r.bottom,minLeft:Math.max(0,m.left),maxRight:Math.min(innerWidth,m.right),minTop:Math.max(0,m.top),maxBottom:Math.min(innerHeight,m.bottom),width:innerWidth}});assert.ok(g.focused&&g.focusVisible);assert.ok(g.left>=g.minLeft&&g.right<=g.maxRight&&g.top>=g.minTop&&g.bottom<=g.maxBottom,'bulk action must be visible at native zoom');const result=view.page.waitForResponse(r=>r.url().endsWith(f.endpoint+'/bulk/publish'));await view.page.keyboard.press('Enter');assert.equal((await result).status(),201);await wait(async()=>await f.form.locator(`#${f.prefix}-effective-from`).inputValue()==='');record(`native200-${kind}-keyboard-publish-focus-visible`,g)}
async function mixedConflict(view,kind,pair,target,oldTarget){
 const org=view.principal.organizationId
 const data={organizationId:org,agentId:pair[0].id,effectiveFrom:new Date(future(14)+'T00:00:00Z'),assignedByUserId:view.principal.id}
 if(kind==='shift')await admin.workforceShiftAssignment.create({data:{...data,templateId:oldTarget}})
 else await admin.workforceSiteAssignment.create({data:{...data,siteId:oldTarget,kind:'PRIMARY'}})
 const before=await total(org,kind);const f=await prepare(view,kind,pair,target);const p=await preview(view,f)
 assert.equal(p.summary.CONFLICT,1);assert.equal(p.summary.READY,1)
 assert.equal(await f.form.locator(`#${f.prefix}-publish-confirm`).count(),0)
 assert.equal(await f.form.getByRole('button',{name:f.publish,exact:true}).count(),0)
 const report=await f.form.innerText();assert.ok(pair.every(e=>report.includes(e.name)))
 await f.form.getByRole('button',{name:view.ui.discardBulkAssignmentDraft,exact:true}).click();assert.equal(await total(org,kind),before)
 record(`${kind}-named-mixed-conflict-report-blocks-whole-draft`)
}
async function scopeSwitch(view,kind,pair,target,nextPrincipal){
 const f=await prepare(view,kind,pair,target);const gate=latch();let held=false
 await view.page.route('**'+f.endpoint+'/preview',async route=>{const response=await route.fetch();held=true;await gate.promise;await route.fulfill({response})})
 await f.form.getByRole('button',{name:f.review,exact:true}).click();await wait(()=>held)
 await auth(view.context,nextPrincipal);await view.page.bringToFront()
 const session=view.page.waitForResponse(r=>r.url().endsWith('/api/auth/session'))
 // Auth.js broadcasts this same session event after another tab signs in.
 await view.page.evaluate(()=>{const channel=new BroadcastChannel('next-auth');channel.postMessage({event:'session',data:{trigger:'getSession'}});channel.close()})
 assert.equal((await session).status(),200)
 await wait(async()=>await f.form.locator(`#${f.prefix}-employee-${pair[0].id}`).count()===0)
 await f.form.locator(`#${f.prefix}-effective-from`).waitFor()
 assert.equal(await f.form.locator(`#${f.prefix}-effective-from`).inputValue(),'')
 gate.release();await view.page.unroute('**'+f.endpoint+'/preview')
 assert.equal(await view.page.locator(`[id="${f.prefix}-publish-confirm"]`).count(),0)
 record(`${kind}-real-session-switch-discards-held-preview`)
}
async function capacity(view,kind,agents,target){
 const f=await prepare(view,kind,agents.slice(0,200),target,30)
 await view.page.locator('#workforce-roster-search').fill(agents[200].name)
 const search=view.page.waitForResponse(r=>r.url().includes('/configuration/assignments?rosterLimit=200&rosterQuery=')&&r.request().method()==='GET')
 await view.page.locator('#workforce-roster-search').press('Enter');await search
 const extra=f.form.locator(`#${f.prefix}-employee-${agents[200].id}`);await extra.waitFor();assert.equal(await extra.isDisabled(),true)
 const p=await preview(view,f);assert.equal(p.items.length,200);assert.equal(p.summary.READY+p.summary.NO_CHANGE,200)
 const live=await f.form.locator('[role="status"]').innerText();assert.ok(agents.every(e=>!live.includes(e.name)))
 await f.form.getByRole('button',{name:view.ui.discardBulkAssignmentDraft,exact:true}).click()
 assert.equal(await extra.isDisabled(),false)
 await view.page.locator('#workforce-roster-search').fill('')
 const reset=view.page.waitForResponse(r=>r.url().includes('/configuration/assignments?rosterLimit=200&rosterQuery=')&&r.request().method()==='GET')
 await view.page.locator('#workforce-roster-search').press('Enter');await reset
 await f.form.locator(`#${f.prefix}-employee-${agents[0].id}`).waitFor()
 record(`${kind}-200-named-retained-selections-and-disabled201st`,{selected:200,aggregateLiveRegion:true})
}

try{
 phase='seed';const passwordHash=await bcrypt.hash(password,4);const principals=[];const agents=[];const templates=[];const sites=[]
 for(let tenant=0;tenant<2;tenant++){
  const org=await admin.organization.create({data:{name:'Synthetic C7 browser',slug:`c7-browser-${suffix}-${tenant}`,plan:'enterprise',features:['workforce-hrm'],modules:{'workforce-hrm':true}}})
  for(const role of tenant===0?['admin','manager']:['admin']){const u=await admin.user.create({data:{organizationId:org.id,name:'Synthetic C7 user',email:`c7-${suffix}-${tenant}-${role}@example.invalid`,passwordHash,role,preferredLanguage:'en'}});principals.push({...u,slug:org.slug})}
  if(tenant===0){const u=principals[0];for(let n=0;n<201;n++)agents.push(await admin.mtmAgent.create({data:{organizationId:org.id,name:`C7 Employee ${String(n).padStart(3,'0')}`}}));for(let n=0;n<2;n++){templates.push(await admin.workforceShiftTemplate.create({data:{organizationId:org.id,code:`C7-${n}`,name:`C7 Shift ${n}`,status:'ACTIVE',version:1,timezone:'Asia/Baku',definition,definitionHash,createdByUserId:u.id}}));sites.push(await admin.workforceSite.create({data:{organizationId:org.id,code:`C7-${n}`,name:`C7 Site ${n}`,type:'OFFICE',timezone:'Asia/Baku',createdByUserId:u.id}}))}}
 }
 phase='launch-browser';browser=await chromium.launch({headless:true,...(process.env.WF_BULK_CHROMIUM?{executablePath:process.env.WF_BULK_CHROMIUM}:{})});let index=0;let en
 for(const locale of ['en','ru','az']){phase=`standard-${locale}`;const view=await open(principals[0],locale,locale==='ru'?{width:390,height:844}:{width:1440,height:1000});if(locale==='en')en=view;for(const kind of ['shift','site']){await standard(view,kind,agents.slice(index,index+2),kind==='shift'?templates[1].id:sites[1].id);index+=2}}
 for(const kind of ['shift','site']){phase=`stale-${kind}`;await stale(en,kind,agents.slice(index,index+2),kind==='shift'?templates[1].id:sites[1].id);phase=`lost-${kind}`;await lost(en,kind,agents.slice(index,index+2),kind==='shift'?templates[1].id:sites[1].id);index+=2}
 for(const kind of ['shift','site']){phase='mixed-conflict-'+kind;await mixedConflict(en,kind,agents.slice(index,index+2),kind==='shift'?templates[1].id:sites[1].id,kind==='shift'?templates[0].id:sites[0].id);index+=2;phase='capacity-'+kind;await capacity(en,kind,agents,kind==='shift'?templates[1].id:sites[1].id)}
 const switchView=await open(principals[0]);phase='session-switch';await scopeSwitch(switchView,'shift',agents.slice(index,index+2),templates[1].id,principals[2]);index+=2
 phase='permission-denials';for(const principal of [principals[1],principals[2]]){const ctx=await browser.newContext({baseURL:origin.origin});contexts.push(ctx);await auth(ctx,principal);for(const kind of ['shift','site']){const endpoint=`/api/v1/workforce/configuration/${kind==='shift'?'assignments':'site-assignments'}/bulk/publish`;const draft={operationId:randomUUID(),agentIds:[agents[0].id],effectiveFrom:future(20),...(kind==='shift'?{templateId:templates[1].id}:{siteId:sites[1].id,kind:'PRIMARY',effectiveTo:null})};const response=await ctx.request.post(endpoint,{headers:{'x-organization-id':principals[0].organizationId},data:draft});assert.ok([403,404].includes(response.status()),'foreign or manager write must be denied')} }record('actual-session-manager-and-foreign-tenant-denied')
 phase='native-zoom';const profile=await mkdtemp(join(tmpdir(),'wf-c7-zoom-'));const extension=fileURLToPath(new URL('./ci/fixtures/workforce-native-zoom-extension',import.meta.url));const context=await chromium.launchPersistentContext(profile,{headless:true,...(process.env.WF_BULK_CHROMIUM?{executablePath:process.env.WF_BULK_CHROMIUM}:{channel:'chromium'}),baseURL:origin.origin,viewport:null,args:['--window-size=640,1400',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});native={context,profile};const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const view=await open(principals[0],'en',undefined,context);const before=await view.page.evaluate(()=>({width:innerWidth,dpr:devicePixelRatio}));const zoom=await worker.evaluate(async target=>{const tabs=await chrome.tabs.query({});const tab=tabs.find(t=>t.url===target);if(!tab)throw Error('fixture tab unavailable');await chrome.tabs.setZoomSettings(tab.id,{mode:'automatic',scope:'per-tab'});await chrome.tabs.setZoom(tab.id,2);return chrome.tabs.getZoom(tab.id)},view.page.url());assert.equal(zoom,2);await wait(async()=>await view.page.evaluate(()=>devicePixelRatio)>before.dpr);const after=await view.page.evaluate(()=>({width:innerWidth,dpr:devicePixelRatio,cssZoom:getComputedStyle(document.body).zoom,visualScale:visualViewport.scale}));assert.equal(after.width,before.width/2);assert.equal(after.dpr,before.dpr*2);assert.equal(after.cssZoom,'1');record('actual-native-browser200-zoom',{before,after,zoom});for(const kind of ['shift','site']){await geometry(view,kind,agents.slice(index,index+2),kind==='shift'?templates[1].id:sites[1].id);index+=2}
 phase='final';assert.equal(await admin.mtmAgentWorkday.count({where:{organizationId:principals[0].organizationId}}),0);assert.equal(await admin.mtmRoute.count({where:{organizationId:principals[0].organizationId}}),0);record('no-workday-or-route-mutation');receipt.status='PASS'
}catch(error){receipt.status='FAIL';receipt.dom=activePage?await activePage.evaluate(()=>({title:document.title,path:location.pathname,heading:[...document.querySelectorAll('h1')].map(x=>x.textContent?.slice(0,100)),inputs:document.querySelectorAll('input,select').length,appError:document.body.innerText.includes('Application error'),login:!!document.querySelector('input[type=password]')})).catch(()=>null):null;receipt.failure={phase,name:error.name,message:error instanceof assert.AssertionError?String(error.message).slice(0,250):'Browser scenario did not complete'};process.exitCode=1}
finally{for(const release of releases)release();for(const c of new Set(contexts))await c.close().catch(()=>events.push('context-close-failed'));await browser?.close().catch(()=>events.push('browser-close-failed'));if(native){await native.context.close().catch(()=>{});await rm(native.profile,{recursive:true,force:true})}await admin.$disconnect();receipt.cleanup=events.length?events:['PASS'];if(events.length){receipt.status='FAIL';process.exitCode=1}await writeFile(join(output,'bulk-browser-receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({status:receipt.status,cases:receipt.cases.length,failure:receipt.failure||null}))}
