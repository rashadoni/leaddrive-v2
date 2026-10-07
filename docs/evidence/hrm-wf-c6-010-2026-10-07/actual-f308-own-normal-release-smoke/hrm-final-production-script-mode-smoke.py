import subprocess,json,pathlib,datetime,hashlib
sha='f3085e5cdf80879bee2e65d06df4e88698afa3e4';rows=[]
proxy=subprocess.check_output(['git','show',sha+':src/proxy.ts']);session=subprocess.check_output(['git','show',sha+':src/lib/session-expired.ts']);assert proxy==pathlib.Path('src/proxy.ts').read_bytes() and session==pathlib.Path('src/lib/session-expired.ts').read_bytes()
assert 'const mode = req.headers.get("sec-fetch-mode")' in proxy.decode() and 'return !!mode && mode !== "navigate"' in proxy.decode() and 'NextResponse.json({ error: "Unauthorized", code: SESSION_EXPIRED_CODE }, { status: 401 })' in proxy.decode() and 'export const SESSION_EXPIRED_CODE = "session_expired"' in session.decode()
for endpoint in ['/api/v1/public/build-info','/api/v1/workforce/exceptions','/api/v1/workforce/exception-reports','/api/v1/public/build-info']:
 raw=subprocess.check_output(['curl','-q','--silent','--show-error','--noproxy','*','--connect-timeout','5','--max-time','12','--resolve','app.leaddrivecrm.org:443:13.140.132.245','--user-agent','Mozilla/5.0','--header','Cache-Control: no-cache','--header','Sec-Fetch-Mode: cors','--write-out','\n%{http_code}|%{ssl_verify_result}\n','https://app.leaddrivecrm.org'+endpoint],timeout=15)
 assert len(raw)<65536
 body,trailer=raw.decode().rstrip('\n').rsplit('\n',1);http,tls=map(int,trailer.split('|'));value=json.loads(body);assert tls==0
 if endpoint.endswith('build-info'):
  assert http==200 and value['artifactSha']==sha and value['sha']==sha[:12];safe={k:value[k] for k in ['sha','artifactSha','builtAt']}
 else:
  assert http==401 and value=={'error':'Unauthorized','code':'session_expired'};safe={'error':'Unauthorized','code':'session_expired','businessPayloadAbsent':True}
 rows.append({'path':endpoint,'http':http,'tlsVerify':tls,'secFetchMode':'cors','value':safe,'observedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat()})
assert rows[0]['value']==rows[-1]['value']
proof={'status':'PASS','head':sha,'deploymentRun':37698256814,'scope':'Additional exact existing browser-script anonymous API401 contract; supplements preserved missing-header307 and original preparation failure, no auth/source/baseline modification','sourceBindings':{'proxySha256':hashlib.sha256(proxy).hexdigest(),'sessionExpiredSha256':hashlib.sha256(session).hexdigest()},'authenticatedHrRead':'NOT RUN — no legitimate existing HR session supplied','productionMutation':False,'observations':rows}
pathlib.Path('/tmp/hrm-final-f308-production-script-mode-smoke.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps({'head':sha,'twoScriptMode401Guards':'PASS','publicFullShaBracket':'PASS','businessPayloadAbsent':True}))
