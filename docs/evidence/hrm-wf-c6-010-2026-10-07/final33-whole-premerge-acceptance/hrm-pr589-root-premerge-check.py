import subprocess,json,pathlib,datetime,hashlib
repo='repos/rashadoni/leaddrive-v2/';head='33f93325599e883973c4c71c256cce8ad91168b3';main='392e0a38e37b9f3915e5ceb2d3b5caf8cd0698ad';tree='225f13aa65017f2901ccc6309674cb948cf11957';accepted='973241bacc296b71fe817d1af11187c32e8126af';archive='c123556e7a758b7eb5264137dcaf85504b07e471'
def api(p):return json.loads(subprocess.check_output(['gh','api',repo+p]))
def blob(ref,path):return subprocess.check_output(['git','show',ref+':'+path])
assert subprocess.check_output(['git','rev-parse','HEAD']).decode().strip()==head
assert not subprocess.check_output(['git','status','--porcelain'])
ref=api('git/ref/heads/main');pr=api('pulls/589');protection=api('branches/main/protection');checks=api('commits/'+head+'/check-runs?per_page=100');wanted={'pr-scope','static-checks','typecheck','runner-policy','scan'};latest={}
for c in sorted(checks['check_runs'],key=lambda v:v['id']):
 if c['name'] in wanted:latest[c['name']]=c
assert ref['object']['sha']==main and pr['head']['sha']==head and pr['base']['ref']=='main' and pr['state']=='open' and not pr['draft'] and not pr['merged'] and pr['mergeable'] is True
assert len(latest)==5 and all(c['head_sha']==head and c['app']['id']==15368 and c['status']=='completed' and c['conclusion']=='success' for c in latest.values())
assert protection['enforce_admins']['enabled'] and not protection['allow_force_pushes']['enabled'] and not protection['allow_deletions']['enabled'] and protection['required_pull_request_reviews']['required_approving_review_count']==0 and protection['required_status_checks']['strict'] is False
assert {(x['context'],x['app_id']) for x in protection['required_status_checks']['checks']}=={(s,15368) for s in wanted}
assert subprocess.check_output(['git','merge-tree','--write-tree',main,head]).decode().splitlines()[0]==tree
for ancestor in [accepted,archive]:subprocess.run(['git','merge-base','--is-ancestor',ancestor,head],check=True)
validation=[]
for number in [606,609]:
 p=api('pulls/'+str(number));assert p['state']=='closed' and not p['merged'];validation.append({'pr':number,'state':p['state'],'merged':p['merged'],'head':p['head']['sha']})
gates=['typecheck-baseline.json','test-baseline.json','scripts/ci/check-typecheck-gate.sh','scripts/ci/check-typecheck-baseline.mjs','scripts/check-test-baseline.mjs']
for p in gates:assert blob(head,p)==blob(accepted,p)==blob(main,p)
tools=[]
for stem in ['hrm-migration-metadata-preflight','hrm-default-acl-inspection','hrm-loopback-acl-inspection','hrm-backup-acl-attribution']:
 for ext in ['mjs','sql','test.mjs']:tools.append('scripts/'+stem+'.'+ext)
 tools.append('.github/workflows/'+stem+'.yml')
for stem in ['hrm-default-acl-inspection','hrm-loopback-acl-inspection','hrm-backup-acl-attribution']:tools.append('docs/'+stem+'-session-log.md')
assert len(tools)==19
for p in tools:assert blob(head,p)==blob(main,p)
owned=subprocess.check_output(['git','diff','--name-only',main,head]).decode().splitlines();assert not any(p.startswith(('src/app/api/v1/support','src/components/support','src/lib/support')) for p in owned)
runIds=[37695306591,37695313330,37695313200,37695313188,37695313323,37695313522,37695313342,37695313267,37695313205,37695313369,37695313326,37695313316];runs=[]
for id in runIds:
 r=api('actions/runs/'+str(id));assert r['head_sha']==head and r['status']=='completed' and r['conclusion']=='success' and r['run_attempt']==1;runs.append({'id':id,'name':r['name'],'event':r['event'],'head':r['head_sha'],'status':r['status'],'conclusion':r['conclusion'],'attempt':r['run_attempt']})
jobs=api('actions/runs/37695306591/jobs')['jobs'];assert len(jobs)==5 and {j['id'] for j in jobs}=={113045459878,113045460004,113045460030,113045460101,113045460165} and all(j['status']=='completed' and j['conclusion']=='success' for j in jobs)
compiler=json.loads(pathlib.Path('/tmp/hrm-final-33-root-compiler-parse-proof.json').read_text());assert compiler['head']==head and compiler['run']==37695306591 and compiler['gated64ExactUnchanged973Baseline'] and len(compiler['owned18CurrentPathCounts'])==18 and set(compiler['owned18CurrentPathCounts'].values())=={0}
backup=json.loads(pathlib.Path('/tmp/hrm-backup-real-392-root-final-assessment.json').read_text());assert backup['main']==main and backup['status']=='ROOT_AND_PEER_SCOPED_DEFAULT_ACL_RECIPIENT_ACCEPTED'
receipts={}
for name in ['hrm-release-independent-source-33f93325-published.json','hrm-release-independent-browser-33f93325.json','hrm-release-independent-pg-build-33f93325.json','hrm-release-independent-compiler-33f93325.json','hrm-backup-real-392-independent-review.json']:
 p=pathlib.Path('/tmp')/name;b=p.read_bytes();v=json.loads(b);assert (main if name.startswith('hrm-backup') else head) in json.dumps(v) and 'ACCEPTED' in v['status'];receipts[name]={'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'status':v['status']}
proof={'atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'main':main,'head':head,'prospectiveTree':tree,'wholeProspectiveEqualsTested33':True,'accepted973AndC123Ancestry':True,'validationOnly':validation,'original5GatesByteUnchanged973':True,'all19InspectorPathsMatchReviewedMain':True,'applicable12':runs,'manual5':[{'id':j['id'],'name':j['name'],'status':j['status'],'conclusion':j['conclusion']} for j in jobs],'requiredChecks':[{'id':c['id'],'context':c['name'],'head':c['head_sha'],'appId':c['app']['id'],'status':c['status'],'conclusion':c['conclusion']} for c in latest.values()],'protection':protection,'receipts':receipts,'scope':'Normal user-authorized reviewed HRM release, exact matched merge. No activation, access/role/grant/config/secrets changes or automatic personnel decisions. Own new main normal artifact/deploy/smoke and post-release evidence still required. Global compiler and suite remain nonclean; C12 operational/physical/restore criteria not closed.'}
pathlib.Path('/tmp/hrm-pr589-root-premerge-proof.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps({'main':main,'head':head,'wholeTree':tree,'required5':'PASS','applicable12':'PASS','manual5':'PASS','baselinePreserved':True,'knownExtraAclPurpose':'BACKUP_READONLY_PROFILE_ACCEPTED'}))
