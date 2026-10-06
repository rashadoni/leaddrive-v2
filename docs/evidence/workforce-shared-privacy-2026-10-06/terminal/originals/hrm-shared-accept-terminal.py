import json,pathlib,hashlib
p=pathlib.Path('/tmp/hrm-shared-terminal-metadata.json');d=json.loads(p.read_text())
H='2d723e02627d2983db91b1d2360fd7592f886e8b';M='5c7412266c29a53e12963621b090c4f1aee95a3a';T='5d1f81a8c306e1d07f22f25f248b206882aabc5e';S='93c23c3546b88ed5f3a316a0e59d8a8718ae640f'
assert d['refs']=={'main':M,'candidate':H,'evidence':'54ef3d5fd6f6bd2a534dc2a81fb1d8be40c93f33'}
pr=d['pr'];assert pr['head']==H and pr['base']==M and pr['synthetic']==S and pr['state']=='open' and not pr['draft'] and not pr['merged'] and pr['mergeable']
assert 'production-build' in pr['labels']
assert d['synthetic']['sha']==S and d['synthetic']['tree']==T and d['synthetic']['parents']==[M,H]
assert d['headCommit']['sha']==H and d['headCommit']['tree']==T and d['headCommit']['parents']==['0fdeeb23e903fcbe873624509631f16989326d0c']
expected={37469035934,37469024320,37469024337,37469024240,37469024732,37469024485,37469024332,37469024221,37469024233,37469024251,37469024323}
assert d['runTotal']==len(d['runs'])==len(expected) and {r['id'] for r in d['runs']}==expected
runs={r['id']:r for r in d['runs']};jobs=[];history=[]
for rid,r in runs.items():
 assert r['head_sha']==H and r['event']=='pull_request' and r['run_attempt']==1 and r['status']=='completed'
 if rid==37469024233: assert r['conclusion']=='cancelled'
 else: assert r['conclusion']=='success'
 group=d['jobs'][str(rid)];assert group['total_count']==len(group['jobs'])
 for j in group['jobs']:
  assert j['run_id']==rid and j['run_attempt']==1 and j['head_sha']==H and j['status']=='completed'
  assert not any('macos' in x.lower() for x in j['labels'])
  if rid!=37469024233: assert 'ubuntu-24.04' in j['labels']
  if rid==37469024233:history.append(j);assert j['conclusion'] in ['cancelled','skipped']
  else:jobs.append(j);assert j['conclusion']=='success'
assert len(jobs)==14 and len(history)==4
assert d['checkTotal']==len(d['checks'])==18
check_ids=set()
for j in jobs+history:
 matches=[c for c in d['checks'] if c['details_url']==j['html_url']]
 assert len(matches)==1,j['name']
 c=matches[0];assert c['name']==j['name'] and c['head_sha']==H and c['app_id']==15368 and c['conclusion']==j['conclusion'];check_ids.add(c['id'])
assert len(check_ids)==18
required={'pr-scope','static-checks','typecheck','runner-policy','scan'}
assert required<=set(j['name'] for j in jobs)
build=next(j for j in jobs if j['name']=='GitHub-hosted Linux production build')
for name in ['Stamp the candidate revision','Build the production standalone bundle','Verify production build outputs']:
 assert any(s['name']==name and s['conclusion']=='success' for s in build['steps']),name
restore=json.load(open('/tmp/hrm-shared-restore-attempt1-root.json'));assert restore['head']==H and restore['synthetic']==S and restore['completed_cases']==15 and restore['source_bindings_verified']==34 and restore['status']=='PASS'
local=json.load(open('/tmp/hrm-shared-local-validation.json'));assert local['finalRegression']=={'passed':386,'failed':0,'skipped':0,'files':23,'sourceHead':H}
report={'status':'EXACT_HEAD_BOUNDED_SOURCE_HOSTED_AND_BUILD_ACCEPTED_PENDING_TERMINAL_ARCHIVE','head':H,'tree':T,'main':M,'synthetic':S,'sourceArchive':d['refs']['evidence'],'requiredPassed':sorted(required),'additionalPassed':[j['name'] for j in jobs if j['name'] not in required and j is not build],'productionBuild':'PASS','currentPassedJobs':14,'allCheckRecords':18,'workflowRecords':11,'successfulWorkflowRecords':10,'supersededCancelledWorkflow':37469024233,'preservedSupersededJobs':4,'allJobsHostedUbuntu2404':True,'allCheckApps':15368,'restore':{'cases':15,'auth':10,'cleanup':2,'sourceBindings':34,'otherMembersRead':False},'local':{'regressionPassed':386,'independentNewPassed':41,'independentCompatibilityPassed':98,'scopedTypingDiagnostics':0,'existingLintUnchanged':6},'limits':['Metadata/source/sanitized Restore JSON only; no raw CI logs or screenshots','Typecheck baseline acceptance is not global zero diagnostics; existing baseline unchanged','Other five Workforce artifacts metadata-only, not visual or full-payload review','No live destination/retention/ACL/native-driver/staging/signed-device acceptance','No merge/deploy/activation or permission change','Ledger82/161DONE79openweighted59 unchanged'],'metadataBinding':{'path':str(p),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}}
pathlib.Path('/tmp/hrm-shared-root-terminal-acceptance.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
