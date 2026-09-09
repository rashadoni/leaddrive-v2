#!/usr/bin/env python3
"""Independent trusted deployment admission. Never accepts an arbitrary artifact."""
import json, os, re, urllib.request, urllib.parse
ROOT = 'https://dev.azure.com/rashadrahimov'
PROJECT = '09c62732-3ff7-442b-8b79-41bf4dffa5ff'
REPO = 'd19677b2-8f20-4999-b1ec-e36780932716'

def api(path):
    req = urllib.request.Request(ROOT + path, headers={'Authorization': 'Bearer ' + os.environ['SYSTEM_ACCESSTOKEN'], 'X-TFS-FedAuthRedirect': 'Suppress'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)
if not os.environ.get('BUILD_SOURCEBRANCH') == 'refs/heads/main':
    raise RuntimeError('Deployment pipeline must be queued from main')
build_id = os.environ.get('BUILD_TRIGGEREDBY_BUILDID', '')
if not build_id.isdigit():
    raise RuntimeError('Deployment requires a successful main build completion trigger')
current_id = os.environ['BUILD_BUILDID']
if not current_id.isdigit():
    raise RuntimeError('Delivery admission condition failed')
current = api(f'/{PROJECT}/_apis/build/builds/{current_id}?api-version=7.1')
if not (current['reason'] == 'buildCompletion' and str(current['triggeredByBuild']['id']) == build_id):
    raise RuntimeError('Deployment was not triggered by the admitted source build')
if not current['definition']['id'] == int(os.environ['LD_PRODUCTION_DEFINITION']):
    raise RuntimeError('Delivery admission condition failed')
build = api(f'/{PROJECT}/_apis/build/builds/{build_id}?api-version=7.1')
if not build['definition']['id'] == int(os.environ['LD_RELEASE_BUILD_DEFINITION']):
    raise RuntimeError('Delivery admission condition failed')
if not build['definition']['revision'] == int(os.environ['LD_RELEASE_DEFINITION_REVISION']):
    raise RuntimeError('Release definition changed since independent approval')
if not (build['repository']['id'] == REPO and build['repository']['type'] == 'TfsGit'):
    raise RuntimeError('Delivery admission condition failed')
if not (build['status'] == 'completed' and build['result'] == 'succeeded'):
    raise RuntimeError('Delivery admission condition failed')
if not build['sourceBranch'] == 'refs/heads/main':
    raise RuntimeError('Delivery admission condition failed')
sha = build['sourceVersion']
if not re.fullmatch('[0-9a-f]{40}', sha):
    raise RuntimeError('Delivery admission condition failed')
refs = api(f'/{PROJECT}/_apis/git/repositories/{REPO}/refs?filter=heads/main&api-version=7.1')['value']
if not (len(refs) == 1 and refs[0]['name'] == 'refs/heads/main' and (refs[0]['objectId'] == sha)):
    raise RuntimeError('A newer main revision superseded this release')
policies = api(f'/{PROJECT}/_apis/policy/configurations?api-version=7.1')['value']
required = [p for p in policies if p.get('isEnabled') and p.get('isBlocking') and (p['type']['id'] == '0609b952-1397-4640-95ec-e00a01b2c241') and any((s.get('repositoryId') == REPO and s.get('refName') == 'refs/heads/main' and (s.get('matchKind') == 'Exact') for s in p['settings'].get('scope', [])))]
if not {int(os.environ['LD_CHECKS_DEFINITION']), int(os.environ['LD_REVIEW_DEFINITION'])} <= {p['settings'].get('buildDefinitionId') for p in required}:
    raise RuntimeError('Required main build validation policies are missing')
if not all((not p['settings'].get('manualQueueOnly', False) for p in required)):
    raise RuntimeError('Main validation must run automatically')
prs = api(f'/{PROJECT}/_apis/git/repositories/{REPO}/pullrequests?searchCriteria.status=completed&searchCriteria.targetRefName=refs/heads/main&$top=100&api-version=7.1')['value']
matching = [p for p in prs if p.get('lastMergeCommit', {}).get('commitId') == sha and p.get('status') == 'completed' and not p.get('completionOptions', {}).get('bypassPolicy', False)]
if len(matching) != 1:
    raise RuntimeError('The admitted main commit must originate from one completed Azure PR without policy bypass')
pr_id = matching[0]['pullRequestId']
artifact = urllib.parse.quote(f'vstfs:///CodeReview/CodeReviewId/{PROJECT}/{pr_id}', safe='')
evaluations = api(f'/{PROJECT}/_apis/policy/evaluations?artifactId={artifact}&api-version=7.1-preview.1')['value']
expected = {int(os.environ['LD_CHECKS_DEFINITION']): int(os.environ['LD_CHECKS_DEFINITION_REVISION']), int(os.environ['LD_REVIEW_DEFINITION']): int(os.environ['LD_REVIEW_DEFINITION_REVISION'])}
for definition_id, revision in expected.items():
    evidence = [e for e in evaluations if e['configuration']['settings'].get('buildDefinitionId') == definition_id and e.get('status') == 'approved']
    if len(evidence) != 1 or not (evidence[0].get('context') or {}).get('buildId'):
        raise RuntimeError(f'Missing successful PR build evidence for definition {definition_id}')
    gate_id = str(evidence[0]['context']['buildId'])
    if not gate_id.isdigit():
        raise RuntimeError('Invalid PR build identity')
    gate = api(f'/{PROJECT}/_apis/build/builds/{gate_id}?api-version=7.1')
    if not (gate['definition']['id'] == definition_id and gate['definition']['revision'] == revision and gate['status'] == 'completed' and gate['result'] == 'succeeded' and gate['repository']['id'] == REPO and gate['reason'] == 'pullRequest'):
        raise RuntimeError(f'PR gate {definition_id} was not run by the reviewed definition revision')
for key, value in [('LD_RELEASE_RUN', build_id), ('DEPLOY_TARGET_SHA', sha)]:
    print(f'##vso[task.setvariable variable={key};isReadOnly=true]{value}')
print(json.dumps({'sourceBuild': build_id, 'sha': sha, 'admission': 'passed'}))
