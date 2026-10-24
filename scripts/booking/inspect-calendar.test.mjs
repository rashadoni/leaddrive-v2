import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {emitCalendarRemote,sanitizeCalendar} from './inspect-calendar.mjs';
const sha='a'.repeat(40),other='b'.repeat(40);
const inventory=()=>({hostCount:1,selectedAccountCount:1,standaloneCount:1,ssoCount:0,noAccountCount:0,missingAccessTokenCount:0,expiredCount:0,expiredWithoutRefreshCount:0,refreshPresentCount:1,identityOnlySsoCount:0,unknownScopeCount:0,missingFreeBusyScopeCount:0,pageFound:true,appAccountSelectAllowed:true,accountRlsEnabled:false,accountRlsForced:false,clientIdConfigured:true,clientSecretConfigured:true,readOnly:true,rlsUnfiltered:true});
test('calendar inventory reports facts without certifying provider or accepting private fields',()=>{
 const value=inventory();value.expiredWithoutRefreshCount=1;
 const result=sanitizeCalendar(JSON.stringify(value),sha,other,0);
 assert.equal(result.status,'PASS_CALENDAR_INVENTORY_ONLY');assert.equal(result.inventory.expiredWithoutRefreshCount,1);
 for(const raw of ['PRIVATE_TOKEN','null','[]','{}',JSON.stringify({...value,access_token:'PRIVATE_TOKEN'}),JSON.stringify({...value,readOnly:false}),JSON.stringify({...value,rlsUnfiltered:false}),JSON.stringify({...value,hostCount:-1})]){
  const result=sanitizeCalendar(raw,sha,other,0);assert.equal(result.status,'ERROR');assert.doesNotMatch(JSON.stringify(result),/PRIVATE_TOKEN|access_token/);
 }
 assert.equal(sanitizeCalendar(JSON.stringify(value),sha,other,255).status,'ERROR');
});
test('calendar selector is bounded and emitted script cannot expose configured credentials',()=>{
 for(const slug of ['',"';select secret;--",'x'.repeat(61),'name\n',"$(touch /tmp/unsafe)"])assert.throws(()=>emitCalendarRemote(sha,slug));
 const script=emitCalendarRemote(sha,'test-page');assert.equal(spawnSync('bash',['-n'],{input:script}).status,0);
 assert.match(script,/BEGIN READ ONLY/);assert.match(script,/default_transaction_read_only=on/);
 assert.match(script,/GOOGLE_CLIENT_SECRET >\/dev\/null/);assert.doesNotMatch(script,/SELECT \*|console\.log|curl |fetch\(/);
 assert.match(script,/booking_calendar_client_id_present=false/);assert.match(script,/slug='test-page'/);
 assert.doesNotMatch(script,/BOOKING_DIAGNOSTIC_SLUG|GOOGLE_CLIENT_ID_PRESENT/);
});
const dbUrl=process.env.BOOKING_PREFLIGHT_TEST_DATABASE_URL;
if(process.env.CI==='true'&&!dbUrl)throw Error('BOOKING_PREFLIGHT_TEST_DATABASE_URL_REQUIRED');
test('actual isolated SQL distinguishes missing connection, expired SSO, preferred standalone, scopes and app grants',{skip:!dbUrl},()=>{
 const parsed=new URL(dbUrl);assert.ok(['127.0.0.1','localhost'].includes(parsed.hostname));
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('PG')));
 Object.assign(env,{PGHOST:parsed.hostname,PGPORT:parsed.port||'5432',PGUSER:decodeURIComponent(parsed.username),PGPASSWORD:decodeURIComponent(parsed.password),PGDATABASE:decodeURIComponent(parsed.pathname.slice(1)),PGOPTIONS:'-c statement_timeout=10s -c lock_timeout=2s'});
 const query=sql=>spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,env,encoding:'utf8',timeout:20000});
 const setup=query(`CREATE TABLE IF NOT EXISTS users(id text,"organizationId" text);
 ALTER TABLE users ADD COLUMN IF NOT EXISTS "isActive" boolean NOT NULL DEFAULT true;
 CREATE TABLE IF NOT EXISTS booking_pages(id text,"organizationId" text);
 ALTER TABLE booking_pages ADD COLUMN IF NOT EXISTS "isActive" boolean NOT NULL DEFAULT true;
 ALTER TABLE booking_pages ADD COLUMN IF NOT EXISTS "hostIds" text[] NOT NULL DEFAULT '{}';
 ALTER TABLE booking_pages ADD COLUMN IF NOT EXISTS slug text;
 CREATE TABLE accounts(id text,"userId" text,provider text,access_token text,refresh_token text,expires_at integer,scope text);
 DO $$BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='hermes') THEN CREATE ROLE hermes;END IF;END$$;
 INSERT INTO users(id,"organizationId") VALUES('calendar-host','calendar-org');
 INSERT INTO booking_pages(id,"organizationId",slug,"hostIds") VALUES('calendar-page','calendar-org','test-page',ARRAY['calendar-host']);`);
 assert.equal(setup.status,0,'create only disposable fixtures');
 const sql=readFileSync(new URL('./inspect-calendar.sql',import.meta.url),'utf8').replace('BOOKING_DIAGNOSTIC_SLUG','test-page').replace('GOOGLE_CLIENT_ID_PRESENT','true').replace('GOOGLE_CLIENT_SECRET_PRESENT','false');
 const read=()=>{const result=query(sql);assert.equal(result.status,0,'actual read-only SQL executes');return JSON.parse(result.stdout);};
 let result=read();assert.equal(result.noAccountCount,1);assert.equal(result.appAccountSelectAllowed,false);assert.equal(result.readOnly,true);assert.equal(result.clientSecretConfigured,false);
 assert.equal(query(`INSERT INTO accounts VALUES('sso','calendar-host','google','PRIVATE_TOKEN',NULL,1,'openid email profile');`).status,0);
 result=read();assert.equal(result.ssoCount,1);assert.equal(result.identityOnlySsoCount,1);assert.equal(result.expiredWithoutRefreshCount,1);assert.equal(result.missingFreeBusyScopeCount,1);
 assert.equal(query(`INSERT INTO accounts VALUES('standalone','calendar-host','google-calendar','PRIVATE_TOKEN','PRIVATE_REFRESH',2147483647,'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly'); GRANT SELECT ON accounts TO hermes;`).status,0);
 result=read();assert.equal(result.selectedAccountCount,1);assert.equal(result.standaloneCount,1);assert.equal(result.ssoCount,0);assert.equal(result.expiredWithoutRefreshCount,0);assert.equal(result.missingFreeBusyScopeCount,0);assert.equal(result.appAccountSelectAllowed,true);
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|calendar-host|calendar-org/);
 assert.equal(sanitizeCalendar(JSON.stringify(result),sha,other,0).status,'PASS_CALENDAR_INVENTORY_ONLY');
 assert.notEqual(query("BEGIN READ ONLY; DELETE FROM accounts;").status,0);
});
