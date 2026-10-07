import subprocess,json,pathlib,datetime
repo='repos/rashadoni/leaddrive-v2/';head='60efe23846fddc7deea16c48ba3a90bd962aae35';main='f8dd20c7a849643087ee31969c2f582a96c8bab3';tree='e57592a08b458c5bfd815029d93fa6a7ae1969b1'
def api(p):return json.loads(subprocess.check_output(['gh','api',repo+p]))
def blob(ref,path):return subprocess.check_output(['git','show',ref+':'+path])
ref=api('git/ref/heads/main');pr=api('pulls/627');protection=api('branches/main/protection');checks=api('commits/'+head+'/check-runs?per_page=100');wanted={'pr-scope','static-checks','typecheck','runner-policy','scan'};latest={}
for c in sorted(checks['check_runs'],key=lambda v:v['id']):
 if c['name'] in wanted:latest[c['name']]=c
assert ref['object']['sha']==main and pr['head']['sha']==head and pr['base']['ref']=='main' and pr['state']=='open' and not pr['draft'] and not pr['merged'] and pr['mergeable'] is True
assert len(latest)==5 and all(c['head_sha']==head and c['app']['id']==15368 and c['status']=='completed' and c['conclusion']=='success' for c in latest.values())
assert protection['enforce_admins']['enabled'] and not protection['allow_force_pushes']['enabled'] and not protection['allow_deletions']['enabled'] and protection['required_pull_request_reviews']['required_approving_review_count']==0 and protection['required_status_checks']['strict'] is False
assert {(x['context'],x['app_id']) for x in protection['required_status_checks']['checks']}=={(s,15368) for s in wanted}
assert subprocess.check_output(['git','merge-tree','--write-tree',main,head]).decode().splitlines()[0]==tree
owned=subprocess.check_output(['git','diff','--name-only',main,head]).decode().splitlines();assert set(owned)=={'scripts/hrm-backup-acl-attribution.mjs','scripts/hrm-backup-acl-attribution.sql','scripts/hrm-backup-acl-attribution.test.mjs','.github/workflows/hrm-backup-acl-attribution.yml','docs/hrm-backup-acl-attribution-session-log.md'}
fixed=['scripts/hrm-default-acl-inspection.mjs','scripts/hrm-default-acl-inspection.sql','scripts/hrm-default-acl-inspection.test.mjs','.github/workflows/hrm-default-acl-inspection.yml','docs/hrm-default-acl-inspection-session-log.md','scripts/hrm-migration-metadata-preflight.mjs','scripts/hrm-migration-metadata-preflight.sql','scripts/hrm-migration-metadata-preflight.test.mjs','.github/workflows/hrm-migration-metadata-preflight.yml','typecheck-baseline.json','test-baseline.json','scripts/ci/check-typecheck-gate.sh','scripts/ci/check-typecheck-baseline.mjs','scripts/check-test-baseline.mjs']
for path in fixed:assert blob(main,path)==blob(head,path)
for path in ['scripts/hrm-loopback-acl-inspection.mjs','scripts/hrm-loopback-acl-inspection.sql','scripts/hrm-loopback-acl-inspection.test.mjs','.github/workflows/hrm-loopback-acl-inspection.yml','docs/hrm-loopback-acl-inspection-session-log.md']:assert blob(main,path)==blob(head,path)
run=api('actions/runs/37692727660');jobs=api('actions/runs/37692727660/jobs');assert run['head_sha']==head and run['status']=='completed' and run['conclusion']=='success';source=next(j for j in jobs['jobs'] if j['name']=='source-validation');assert source['id']==113036666929 and source['conclusion']=='success'
for p in ['source','hosted']:
 r=json.loads(pathlib.Path('/tmp/hrm-backup-acl-independent-'+p+'-60efe238.json').read_text());assert head in json.dumps(r)
proof={'atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'main':main,'head':head,'prospectiveTree':tree,'fiveNewPathsOnly':True,'wholeProspectiveEqualsTested60':True,'original14And5GatesByteUnchanged':True,'actualHosted66NoSkips':'PASS','requiredChecks':[{'id':v['id'],'context':v['name'],'head':v['head_sha'],'appId':v['app']['id'],'status':v['status'],'conclusion':v['conclusion']} for v in latest.values()],'protection':protection,'scope':'Normal source-only auxiliary merge; own SHA-bound normal production quality/build/deploy still required before protected readonly observation; no ACL approval/HRM release'}
pathlib.Path('/tmp/hrm-pr627-root-premerge-proof.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps({'main':main,'head':head,'wholeTree':tree,'required5':'PASS','hosted66':'PASS'}))
