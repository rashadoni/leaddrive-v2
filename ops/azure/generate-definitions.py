#!/usr/bin/env python3
"""Generate trusted classic definitions. Never read candidate YAML on the agent."""
import base64,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
HERE=Path(__file__).resolve().parent
PROJECT='09c62732-3ff7-442b-8b79-41bf4dffa5ff'
REPO='d19677b2-8f20-4999-b1ec-e36780932716'
BASH='6c731c3c-3c68-459a-a5c9-bde6e6595b5b'
PUBLISH='ecdc45f6-832d-4ad9-b52b-ee49e94659be'
NODE='31c75bbb-bcdf-4706-8d7c-4da6a1959bc2'
DOWNLOAD='61f2a582-95ae-4948-b34d-a1b3c4f6a737'

def step(name,script,env=None,condition='succeeded()',minutes=15):
 return {'displayName':name,'enabled':True,'continueOnError':False,'timeoutInMinutes':minutes,'condition':condition,'task':{'id':BASH,'versionSpec':'3.*','definitionType':'task'},'inputs':{'targetType':'inline','script':script,'workingDirectory':'$(Build.SourcesDirectory)'},'environment':env or {}}
def task(name,id,version,inputs,condition='succeeded()'):
 return {'displayName':name,'enabled':True,'continueOnError':False,'condition':condition,'task':{'id':id,'versionSpec':version,'definitionType':'task'},'inputs':inputs}
def python_step(name,filename,env=None):
 return step(name,"python3 - <<'AZURE_TRUSTED_PY'\n"+(HERE/filename).read_text()+"\nAZURE_TRUSTED_PY",env)
def definition(name,steps,queue=12,hosted=False,groups=(),trigger=False,minutes=80,oauth=False):
 target={'type':1,'executionOptions':{'type':0},'allowScriptsAuthAccessOption':oauth}
 if hosted:target['agentSpecification']={'identifier':'ubuntu-24.04'}
 return {'name':name,'path':'\\Azure delivery','type':'build','queueStatus':'disabled','jobAuthorizationScope':'project','jobTimeoutInMinutes':minutes,'jobCancelTimeoutInMinutes':2,'queue':{'id':queue},'repository':{'id':REPO,'type':'TfsGit','name':'leaddrive-v2','defaultBranch':'refs/heads/main','url':'https://dev.azure.com/rashadrahimov/leaddrive-v2/_git/leaddrive-v2','clean':'true','properties':{'cleanOptions':'0','reportBuildStatus':'true','fetchDepth':'0','checkoutNestedSubmodules':'false','lfs':'false'}},'process':{'type':1,'phases':[{'name':'Verified delivery','refName':'Job_1','condition':'succeeded()','jobAuthorizationScope':'project','target':target,'steps':steps}]},'variableGroups':list(groups),'variables':{'LD_HEAVY':{'value':'true','allowOverride':False}},'triggers':[{'triggerType':'continuousIntegration','branchFilters':['+refs/heads/main'],'pathFilters':[],'batchChanges':True,'maxConcurrentBuildsPerBranch':1}] if trigger else []}

prepare=python_step('Resolve exact Azure candidate without executing source','resolve-candidate.py')
strip=step('Remove checkout credential before sandbox',r'''set -Eeuo pipefail
while IFS= read -r key; do git config --local --unset-all "$key"; done < <(git config --local --name-only --get-regexp '^(http\..*extraheader|credential\.helper)$' || true)
if git config --local --get-regexp '^(http\..*extraheader|credential\.helper)$' >/dev/null; then exit 1; fi
''')
validate=step('Isolated static and type checks',r'''set -Eeuo pipefail
if [ "$LD_HEAVY" != true ]; then echo 'Documentation-only: heavy checks do not apply'; exit 0; fi
unset SYSTEM_ACCESSTOKEN AZURE_DEVOPS_EXT_PAT
/usr/local/bin/leaddrive-azure-ci validate "$BUILD_SOURCESDIRECTORY" "$BUILD_ARTIFACTSTAGINGDIRECTORY" "$BUILD_BUILDID" "$BUILD_SOURCEVERSION"
''',minutes=76)
checks=definition('leaddrive-checks',[prepare,strip,validate,task('Publish gate diagnostics',PUBLISH,'1.*',{'path':'$(Build.ArtifactStagingDirectory)','artifactName':'ci-diagnostics','artifactType':'pipeline'},'succeededOrFailed()')])
main_gate=step('Release is permitted only from main',r'''set -Eeuo pipefail
test "$BUILD_SOURCEBRANCH" = refs/heads/main
test "$BUILD_REASON" != PullRequest
''')
release=definition('leaddrive-release-build',[main_gate,prepare,strip,step('Quality gates and immutable production build',r'''set -Eeuo pipefail
unset SYSTEM_ACCESSTOKEN AZURE_DEVOPS_EXT_PAT
/usr/local/bin/leaddrive-azure-ci build "$BUILD_SOURCESDIRECTORY" "$BUILD_ARTIFACTSTAGINGDIRECTORY" "$BUILD_BUILDID" "$BUILD_SOURCEVERSION"
''',{'NEXT_PUBLIC_CARTO_BASEMAPS_API_KEY':'$(CARTO_BASEMAPS_API_KEY)'},minutes=76),task('Publish SHA-bound release',PUBLISH,'1.*',{'path':'$(Build.ArtifactStagingDirectory)','artifactName':'release','artifactType':'pipeline'})],trigger=True)
reviewjs=base64.b64encode((ROOT/'.github/scripts/agent-review.mjs').read_bytes()).decode()
review=definition('leaddrive-agent-review',[prepare,task('Node.js 20',NODE,'0.*',{'versionSpec':'20.x'}),step('Independent agent review from trusted definition',r'''set -Eeuo pipefail
mkdir -p "$BUILD_ARTIFACTSTAGINGDIRECTORY"
git diff "$LD_BASE_SHA...$LD_HEAD_SHA" > "$BUILD_ARTIFACTSTAGINGDIRECTORY/review.diff"
if [ "$(wc -c < "$BUILD_ARTIFACTSTAGINGDIRECTORY/review.diff")" -gt 400000 ]; then echo 'Diff exceeds bounded review size'; exit 1; fi
printf '%s' __REVIEW_JS__ | base64 --decode > "$AGENT_TEMPDIRECTORY/review.mjs"
if [ -z "${ANTHROPIC_API_KEY:-}" ] || [[ "$ANTHROPIC_API_KEY" = '$('* ]]; then
 python3 - <<'NOTE'
import json,os
from pathlib import Path
(Path(os.environ['BUILD_ARTIFACTSTAGINGDIRECTORY'])/'review.json').write_text(json.dumps({'findings':[],'markdown':'NOT reviewed: ANTHROPIC_API_KEY is not configured. The existing delivery policy permits an explicit warned fallback; this is not a completed review.','reviewUnavailable':True}))
NOTE
 echo '##vso[task.logissue type=warning]The change was NOT reviewed: review credential missing.'
else
 set +e
 node "$AGENT_TEMPDIRECTORY/review.mjs" --diff "$BUILD_ARTIFACTSTAGINGDIRECTORY/review.diff" --out "$BUILD_ARTIFACTSTAGINGDIRECTORY/review.json"
 status=$?
 set -e
 echo "$status" > "$BUILD_ARTIFACTSTAGINGDIRECTORY/review-exit-code"
fi
'''.replace('__REVIEW_JS__',reviewjs),{'ANTHROPIC_API_KEY':'$(ANTHROPIC_API_KEY)'},minutes=10),step('Publish review to the exact Azure PR and enforce verdict',r'''python3 - <<'PYREVIEW'
import json,os,urllib.request
from pathlib import Path
p=Path(os.environ['BUILD_ARTIFACTSTAGINGDIRECTORY'])
r=json.loads((p/'review.json').read_text())
pr=os.environ.get('SYSTEM_PULLREQUEST_PULLREQUESTID','')
if pr:
 if not pr.isdigit(): raise RuntimeError('Invalid Azure PR id')
 url='https://dev.azure.com/rashadrahimov/09c62732-3ff7-442b-8b79-41bf4dffa5ff/_apis/git/repositories/d19677b2-8f20-4999-b1ec-e36780932716/pullRequests/'+pr+'/threads?api-version=7.1'
 text='Azure independent review for '+os.environ['LD_HEAD_SHA']+'\n\n'+str(r.get('markdown','No review report'))
 req=urllib.request.Request(url,data=json.dumps({'comments':[{'parentCommentId':0,'content':text,'commentType':1}],'status':1}).encode(),headers={'Authorization':'Bearer '+os.environ['SYSTEM_ACCESSTOKEN'],'Content-Type':'application/json','X-TFS-FedAuthRedirect':'Suppress'},method='POST')
 with urllib.request.urlopen(req,timeout=30) as response:
  if response.status not in (200,201): raise RuntimeError('Unable to publish review verdict')
status=int((p/'review-exit-code').read_text()) if (p/'review-exit-code').exists() else 0
raise SystemExit(status)
PYREVIEW''',{'SYSTEM_ACCESSTOKEN':'$(System.AccessToken)'}),task('Publish review evidence',PUBLISH,'1.*',{'path':'$(Build.ArtifactStagingDirectory)','artifactName':'review','artifactType':'pipeline'},'succeededOrFailed()')],queue=9,hosted=True,minutes=20,oauth=True)
scan=step('Secret scan against trusted base configuration',r"""set -Eeuo pipefail
version=8.30.1
archive="$AGENT_TEMPDIRECTORY/gitleaks.tar.gz"
curl --fail --silent --show-error --location --connect-timeout 15 --max-time 120 "https://github.com/gitleaks/gitleaks/releases/download/v${version}/gitleaks_${version}_linux_x64.tar.gz" -o "$archive"
printf '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb  %s\n' "$archive" | sha256sum --check --strict
tar -xzf "$archive" -C "$AGENT_TEMPDIRECTORY" gitleaks
git show "$LD_BASE_SHA:.gitleaks.toml" > "$AGENT_TEMPDIRECTORY/gitleaks.toml"
"$AGENT_TEMPDIRECTORY/gitleaks" git --config "$AGENT_TEMPDIRECTORY/gitleaks.toml" --log-opts="$LD_BASE_SHA..$LD_HEAD_SHA" --redact --no-banner --exit-code 1 .
""",minutes=5)
review['process']['phases'][0]['steps'].insert(1,scan)

# Groups bind only public build config, independent review, and production,
# respectively. No production credential is given to the persistent CI agent.
release['variableGroups']=[{'id':1}]
review['variableGroups']=[{'id':2}]
deploy_files={p.name:base64.b64encode(p.read_bytes()).decode() for p in HERE.iterdir() if p.name.startswith('production-') or p.name in ['deploy-admission.py','verify-release.py']}
unpack="""python3 - <<'TRUSTED_DEPLOY_FILES'
import base64,json,os
from pathlib import Path
p=Path(os.environ['AGENT_TEMPDIRECTORY'])/'trusted-deploy';p.mkdir(exist_ok=True)
for name,data in json.loads(__FILES__).items():(p/name).write_bytes(base64.b64decode(data))
print('##vso[task.setvariable variable=LD_TRUSTED_DEPLOY_DIRECTORY;isReadOnly=true]'+str(p))
TRUSTED_DEPLOY_FILES
""".replace('__FILES__',repr(json.dumps(deploy_files)))
production=definition('leaddrive-production',[
 python_step('Admit successful protected main build','deploy-admission.py',{'SYSTEM_ACCESSTOKEN':'$(System.AccessToken)'}),
 task('Download exact successful main artifact',DOWNLOAD,'2.*',{'buildType':'specific','project':PROJECT,'definition':'5','specificBuildWithTriggering':'false','buildVersionToDownload':'specific','pipelineId':'$(LD_RELEASE_RUN)','artifactName':'release','targetPath':'$(Pipeline.Workspace)/release'}),
 python_step('Verify release checksums and source identity','verify-release.py',{'LD_RELEASE_DIRECTORY':'$(Pipeline.Workspace)/release'}),
 step('Prepare reviewed production controller',unpack),
 step('Configure pinned production connection',r'''set -Eeuo pipefail
test "$SERVER_HOST" = 13.140.132.245
test "$SERVER_USER" = root
test -n "$DEPLOY_SSH_KEY"
test -n "$SERVER_SSH_KNOWN_HOSTS"
umask 077
mkdir -p ~/.ssh
printf '%s\n' "$DEPLOY_SSH_KEY" > ~/.ssh/deploy_key
printf '%s\n' "$SERVER_SSH_KNOWN_HOSTS" > ~/.ssh/known_hosts
ssh-keygen -F "$SERVER_HOST" -f ~/.ssh/known_hosts >/dev/null
cat > ~/.ssh/config <<'SSHCFG'
Host *
  StrictHostKeyChecking yes
  UserKnownHostsFile ~/.ssh/known_hosts
  ConnectTimeout 30
  ConnectionAttempts 2
  ServerAliveInterval 15
  ServerAliveCountMax 4
SSHCFG
''',{'DEPLOY_SSH_KEY':'$(SSH_PRIVATE_KEY)','SERVER_SSH_KNOWN_HOSTS':'$(SERVER_SSH_KNOWN_HOSTS)','SERVER_HOST':'$(SERVER_HOST)','SERVER_USER':'$(SERVER_USER)'}),
 step('Atomic deployment and all production checks',r'''set -Eeuo pipefail
python3 "$LD_TRUSTED_DEPLOY_DIRECTORY/production-ceremony.py"
''',{'SYSTEM_ACCESSTOKEN':'$(System.AccessToken)','SERVER_HOST':'$(SERVER_HOST)','SERVER_USER':'$(SERVER_USER)','NEXTAUTH_URL':'$(NEXTAUTH_URL)','LD_RELEASE_DIRECTORY':'$(Pipeline.Workspace)/release','DEPLOYMENT_MODE':'normal'},minutes=60),
 step('Remove temporary production credential',r'''set -Eeuo pipefail
rm -f ~/.ssh/deploy_key ~/.ssh/known_hosts ~/.ssh/config
''',condition='always()',minutes=2),
 task('Publish production evidence',PUBLISH,'1.*',{'path':'$(Build.ArtifactStagingDirectory)','artifactName':'production-evidence','artifactType':'pipeline'},'succeededOrFailed()')
],queue=9,hosted=True,groups=[{'id':3}],minutes=70,oauth=True)
production['variables'].update({k:{'value':str(v),'allowOverride':False} for k,v in {'LD_RELEASE_BUILD_DEFINITION':5,'LD_RELEASE_DEFINITION_REVISION':4,'LD_PRODUCTION_DEFINITION':7,'LD_CHECKS_DEFINITION':4,'LD_CHECKS_DEFINITION_REVISION':4,'LD_REVIEW_DEFINITION':6,'LD_REVIEW_DEFINITION_REVISION':4}.items()})
production['triggers']=[{'triggerType':'buildCompletion','definition':{'id':5,'project':{'id':PROJECT}},'branchFilters':['+refs/heads/main'],'requiresSuccessfulBuild':True}]

if __name__=='__main__':
 out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
 for name,payload in [('checks',checks),('release-build',release),('agent-review',review),('production',production)]:
  (out/(name+'.json')).write_text(json.dumps(payload,indent=2)+'\n')
 print('Generated four trusted classic definitions; no PR YAML is executed.')
