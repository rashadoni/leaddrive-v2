import json,subprocess,sys,re,datetime,hashlib,urllib.parse
from pathlib import Path
sha=sys.argv[1];run=int(sys.argv[2]);target=Path(sys.argv[3]);assert re.fullmatch('[0-9a-f]{40}',sha) and not target.exists()
proxy=subprocess.check_output(['git','show',sha+':src/proxy.ts']);assert proxy==Path('src/proxy.ts').read_bytes()
for statement in ['if (!req.auth) {','const loginUrl = new URL("/login", baseUrl)','loginUrl.searchParams.set("callbackUrl", pathname)','return withCspHeaders(NextResponse.redirect(loginUrl), nonce)']:assert statement in proxy.decode()
rows=[]
def request(path,expected):
 raw=subprocess.check_output(['curl','-q','--silent','--show-error','--noproxy','*','--connect-timeout','5','--max-time','12','--resolve','app.leaddrivecrm.org:443:13.140.132.245','--user-agent','Mozilla/5.0','--header','Cache-Control: no-cache','--dump-header','-','--write-out','\n%{http_code}|%{ssl_verify_result}\n','https://app.leaddrivecrm.org'+path],timeout=15)
 assert len(raw)<=1048576
 message,trailer=raw.decode().rstrip('\n').rsplit('\n',1);http,tls=map(int,trailer.split('|'));assert http==expected and tls==0
 headers,body=message.split('\r\n\r\n',1)
 observation={'path':path,'http':http,'tlsVerify':tls,'pinnedAddress':'13.140.132.245','observedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 if expected==307:
  locations=[s.partition(':')[2].strip() for s in headers.splitlines() if s.lower().startswith('location:')];expectedHref='https://app.leaddrivecrm.org/login?'+urllib.parse.urlencode({'callbackUrl':path})
  assert locations==[expectedHref] and body.strip()==expectedHref
  observation['value']={'unauthenticatedRedirectToOwnLogin':True,'sameOrigin':True,'exactCallbackPath':path,'redirectBodyOnly':True,'businessPayloadAbsent':True,'redirectFollowed':False}
 elif path.endswith('build-info'):
  value=json.loads(body);assert value['artifactSha']==sha and value['sha']==sha[:12];observation['value']={k:value[k] for k in ['sha','artifactSha','builtAt']}
 else:
  value=json.loads(body);assert value.get('ok') is True;observation['value']={'ok':True}
 rows.append(observation)
request('/api/v1/public/build-info',200)
request('/api/v1/ping',200)
request('/api/v1/workforce/exceptions',307)
request('/api/v1/workforce/exception-reports',307)
request('/api/v1/public/build-info',200)
assert rows[0]['value']==rows[-1]['value']
proof={'expectedMain':sha,'deploymentRun':run,'scope':'Exact final HRM release canonical pinned TLS public bracket and current source-bound anonymous proxy guards only','status':'PASS','proxySourceSha256':hashlib.sha256(proxy).hexdigest(),'correctedPreparationAssumption':'Original unexecuted helper expected handler401; actual unchanged production proxy intercepts anonymous requests with exact307 own/login callback redirect. Original attempt1 assertion failure and diagnosis preserved; no application/auth/baseline source changed.','productionMutation':False,'authenticatedHrRead':'NOT RUN — no existing legitimate HR session supplied; no users/tokens/grants manufactured','realHrOperations':'NOT RUN — hosted synthetic browser evidence is not live HR operational observation','observations':rows}
target.write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps({'expectedMain':sha,'publicBracket':'PASS','exactAnonymous307OwnLoginGuards':'PASS','authenticatedHrRead':'NOT RUN','productionMutation':False}))
