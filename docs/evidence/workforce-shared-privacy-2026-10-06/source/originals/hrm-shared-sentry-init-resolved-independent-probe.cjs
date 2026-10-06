const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
global.document={visibilityState:'hidden',addEventListener(){},removeEventListener(){}};
global.addEventListener=()=>{};global.removeEventListener=()=>{};
const root='/workspace/hrm-shared-privacy/';const ts=require(root+'node_modules/typescript');
const bindings=[];
function load(path,deps){const raw=fs.readFileSync(root+path,'utf8');bindings.push({path,sha256:crypto.createHash('sha256').update(raw).digest('hex')});const mod={exports:{}};vm.runInNewContext(ts.transpileModule(raw,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{module:mod,exports:mod.exports,require:n=>{if(!(n in deps))throw Error('unapproved import');return deps[n]}});return mod.exports;}
const fields=load('src/lib/telemetry/safe-fields.ts',{}),policy=load('src/lib/telemetry/sentry-privacy.ts',{'./safe-fields':fields});
const browser=require(root+'node_modules/@sentry/browser'),CANARY='SYNTHETIC_PRIVATE_STARTUP';
const wires=[];let returned=false;
const client=browser.init({dsn:'https://public@synthetic.invalid/1',release:'a'.repeat(40),environment:'test',defaultIntegrations:[browser.browserSessionIntegration(),{name:'IndependentStartupEmitter',beforeSetup(c){void c.sendEnvelope([{},[[{type:'session'},{sid:CANARY}],[{type:'event'},{message:CANARY,sdk:{settings:{infer_ip:'auto'}},user:{email:CANARY}}]]])}}],...policy.privateSentryOptions,transport:()=>({send:async e=>{wires.push({beforeInitReturn:!returned,wire:JSON.stringify(e)});return{statusCode:200}},flush:async()=>true})});
returned=true;
client.captureEvent({message:CANARY,user:{email:CANARY}});
(async()=>{await client.flush(1000);const result={scope:'actual_browser_init_hidden_document_actual_BrowserSession_default_and_synthetic_pre_setup_emitter_then_captureEvent_memory_transport',sdk:require(root+'node_modules/@sentry/browser/package.json').version,bindings,networkCalls:0,browserSessionRemoved:!client.getIntegrationByName('BrowserSession'),privacyIntegrationPresent:!!client.getIntegrationByName('ApplicationPrivacyBoundary'),transportCalls:wires.length,events:wires.map(x=>{const e=JSON.parse(x.wire);return{beforeInitReturn:x.beforeInitReturn,itemTypes:e[1].map(i=>i[0].type),inferIp:e[1].map(i=>i[1]?.sdk?.settings?.infer_ip),privateCanaryRetained:x.wire.includes(CANARY)}})};fs.writeFileSync('/tmp/hrm-shared-sentry-init-resolved-independent-probe.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));await client.close()})().catch(e=>{console.error(e.name);process.exitCode=1});
