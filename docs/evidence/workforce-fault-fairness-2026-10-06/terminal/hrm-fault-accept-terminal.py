import json,pathlib,hashlib,datetime
B=pathlib.Path('/tmp');head='b896cdb35246c22bcaddb176774a5c1b528190f9';main='5c7412266c29a53e12963621b090c4f1aee95a3a';tree='56054b2aaf225d54668c7c99b19d6f276c81f02b';synthetic='d28db54c37d62248b029fe935bea6cb5b85a6b86'
meta=json.load(open(B/'hrm-fault-terminal-metadata.json'));r=meta['resources']
runs=r[f'actions/runs?head_sha={head}&per_page=100'];checks=r[f'commits/{head}/check-runs?per_page=100']
assert runs['total_count']==len(runs['workflow_runs'])==9
assert checks['total_count']==len(checks['check_runs'])==12
assert len({x['id'] for x in runs['workflow_runs']})==9
assert r['git/ref/heads/main']['object']['sha']==main
assert r['git/ref/heads/codex/hrm-588-validation-20261005']['object']['sha']==head
assert r['git/ref/pull/589/merge']['object']['sha']==synthetic
c=r['git/commits/'+head];assert c['tree']['sha']==tree and [x['sha'] for x in c['parents']]==['8053702bbde2a43da537e263630f8a81ded2b659',main]
c=r['git/commits/'+synthetic];assert c['tree']['sha']==tree and [x['sha'] for x in c['parents']]==[main,head]
pr=r['pulls/589'];assert pr['state']=='open' and not pr['merged'] and pr['head']['sha']==head and pr['base']['sha']==main
jobs={};artifacts=[]
for run in runs['workflow_runs']:
 assert run['head_sha']==head and run['event']=='pull_request' and run['run_attempt']==1 and run['status']=='completed' and run['conclusion']=='success',run['id']
 for p in run['pull_requests']:
  assert p['number']==589 and p['head']['sha']==head and p['base']['sha']==main
 j=r[f"actions/runs/{run['id']}/jobs?per_page=100"];assert j['total_count']==len(j['jobs'])
 for x in j['jobs']:
  assert x['run_id']==run['id'];jobs[x['id']]=x
 a=r[f"actions/runs/{run['id']}/artifacts?per_page=100"];assert a['total_count']==len(a['artifacts']);artifacts+=a['artifacts']
assert len(jobs)==12 and len(artifacts)==6
mandatory={'pr-scope','static-checks','typecheck','runner-policy','scan'};passed=[];skipped=[]
for check in checks['check_runs']:
 assert check['head_sha']==head and check['app']['id']==15368 and check['status']=='completed'
 job=jobs[check['id']];assert job['name']==check['name'] and job['html_url']==check['details_url'] and job['conclusion']==check['conclusion']
 if check['name']=='GitHub-hosted Linux production build':assert check['conclusion']=='skipped';skipped.append(check['name'])
 else:assert check['conclusion']=='success';passed.append(check['name'])
assert mandatory.issubset(passed) and len(passed)==11 and len(skipped)==1
for a in artifacts:
 assert not a['expired'] and a['workflow_run']['head_sha']==head and synthetic in a['name'] and a['name'].endswith('-1') and a['digest'].startswith('sha256:')
restore=json.load(open(B/'hrm-fault-restore-attempt1-root.json'));assert restore['status']=='PASS' and restore['head']==head and restore['synthetic']==synthetic and restore['source_bindings_verified']==34
review=json.load(open(B/'hrm-fault-independent-terminal-20261006.json'))
assert review['head']==head and review['tree']==tree and review['status']=='EXACT_HEAD_BOUNDED_SOURCE_AND_HOSTED_ACCEPTED'
def bind(n):
 p=B/n;b=p.read_bytes();return {'path':str(p),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
out={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'EXACT_HEAD_BOUNDED_CANDIDATE_READY_NO_PRODUCTION_ACTIVATION','head':head,'tree':tree,'freshMain':main,'synthetic':synthetic,'requiredChecks':sorted(mandatory),'additionalChecks':[x for x in passed if x not in mandatory],'allPassed':11,'optionalBuild':'SKIPPED_BY_EXISTING_POLICY','firstAttemptRuns':[{'id':x['id'],'name':x['name'],'conclusion':x['conclusion'],'attempt':1} for x in runs['workflow_runs']],'metadataCompleteness':{'runs':9,'checks':12,'jobs':12,'artifacts':6,'appId':15368},'restore':restore,'evidenceScope':'Metadata for all checks and artifacts; only allowlisted restore-rendered-ui-receipt.json payload examined. No raw CI logs or screenshots; other five browser artifact payloads metadata-only.','sourceArchive':'a10975647599a004e44d25953e00971400bdd989','historical8053Archive':'b0d41908058093c41d18910d1d6bd470ba8847f2','supports':[bind(n) for n in ['hrm-fault-terminal-metadata.json','hrm-fault-independent-terminal-20261006.json','hrm-fault-root-source-acceptance.json','hrm-fault-independent-source-b896-20261006.json','hrm-fault-root-durable-source.json','hrm-fault-restore-independent-review-20261006.json','hrm-fault-local-validation.json','hrm-fault-local-cleanup.json','hrm-fault-next-dependencies.md']],'qualification':['Local production55diagnostics equal integrated baseline55; test57 adds two unchanged fixture TS2737; not globally clean compiler.','Original broad2728PASS/18spawnFAIL/168SKIP retained; affected unchanged files32PASS retry; not a single all-green broad run.','No signed-device/physical network/representative5k load/cluster failover/full migration replay or production acceptance.','Shared auth/Pino/Sentry/cardinality/collector/destination criteria remain open.','No merge/deploy/productionactivation/migrationhistory/baseline/credentials/permissions changes; Support exact main.'],'canonical':{'done':82,'total':161,'open':79,'weightedPercent':59,'gates':'14/15','C12-008':'PARTIAL','C10-011':'PLANNED'}}
(B/'hrm-fault-root-terminal-acceptance.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps({k:out[k] for k in ['status','head','freshMain','allPassed','metadataCompleteness']}))
