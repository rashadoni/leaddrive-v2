import json,subprocess,sys,re,datetime
from pathlib import Path
sha=sys.argv[1];run=int(sys.argv[2]);target=Path(sys.argv[3]);assert re.fullmatch('[0-9a-f]{40}',sha) and not target.exists()
rows=[]
def observe(path,expected):
    raw=subprocess.check_output(['curl','-q','--silent','--show-error','--noproxy','*','--connect-timeout','5','--max-time','12','--resolve','app.leaddrivecrm.org:443:13.140.132.245','--user-agent','Mozilla/5.0','--header','Cache-Control: no-cache','--write-out','\n%{http_code}|%{ssl_verify_result}\n','https://app.leaddrivecrm.org'+path],timeout=15)
    assert len(raw)<=65536
    body,trailer=raw.decode().rstrip('\n').rsplit('\n',1);http,tls=map(int,trailer.split('|'));assert http==expected and tls==0
    value=json.loads(body)
    if path.endswith('build-info'):
        assert value['artifactSha']==sha and value['sha']==sha[:12]
        safe={k:value[k] for k in ['sha','artifactSha','builtAt']}
    elif path.endswith('/ping'):
        assert value.get('ok') is True;safe={'ok':True}
    else:
        assert set(value)<={'error','code','success'} and value.get('error') and not value.get('success');safe={'unauthenticatedDenied':True,'businessPayloadAbsent':True}
    rows.append({'path':path,'http':http,'tlsVerify':tls,'pinnedAddress':'13.140.132.245','value':safe,'observedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat()})
observe('/api/v1/public/build-info',200)
observe('/api/v1/ping',200)
observe('/api/v1/workforce/exceptions',401)
observe('/api/v1/workforce/exception-reports',401)
observe('/api/v1/public/build-info',200)
proof={'expectedMain':sha,'deploymentRun':run,'scope':'Exact final HRM release canonical pinned TLS public and anonymous feature GET guards only','status':'PASS','productionMutation':False,'authenticatedHrRead':'NOT RUN — no existing legitimate HR session supplied; no users/tokens/grants manufactured','realHrOperations':'NOT RUN — hosted synthetic browser evidence is not live HR operational observation','observations':rows}
target.write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps({'expectedMain':sha,'publicBracket':'PASS','anonymousFeatureGuards':'PASS','authenticatedHrRead':'NOT RUN','productionMutation':False}))
