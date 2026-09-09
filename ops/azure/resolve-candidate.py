#!/usr/bin/env python3
"""Trusted classic step: classify an Azure merge-ref without executing source."""
import json, os, re, subprocess, fnmatch
from pathlib import Path

def git(*args):
    return subprocess.check_output(['git', *args], text=True).strip()
sha = git('rev-parse', 'HEAD')
if not re.fullmatch('[0-9a-f]{40}', sha):
    raise RuntimeError('Delivery admission condition failed')
if not sha == os.environ['BUILD_SOURCEVERSION']:
    raise RuntimeError('Delivery admission condition failed')
reason = os.environ.get('BUILD_REASON', '')
if reason == 'PullRequest':
    if not os.environ.get('SYSTEM_PULLREQUEST_TARGETBRANCH') == 'refs/heads/main':
        raise RuntimeError('Delivery admission condition failed')
    parents = git('show', '-s', '--format=%P', 'HEAD').split()
    if not len(parents) == 2:
        raise RuntimeError('Azure PR validation must use the merge commit')
    base, head = parents
else:
    base = git('rev-parse', 'HEAD^')
    head = sha
names = subprocess.check_output(['git', 'diff', '--name-only', '-z', base + '...' + head]).decode().split('\x00')
names = [n for n in names if n]
heavy = any((not (n.endswith('.md') or n.startswith(('docs/', '.agents/'))) for n in names))
social_paths = ['prisma/schema.prisma', 'prisma/migrations/20260801160000_social_monitoring_server_run_queue/**', 'scripts/social-monitoring-server-queue-e2e.mjs', 'messages/*.json', 'src/app/(dashboard)/social-monitoring/**', 'src/app/api/cron/social-monitoring-run-jobs/**', 'src/app/api/v1/social/monitoring-run-jobs/**', 'src/__tests__/api-social-monitoring-*.test.ts', 'src/__tests__/lib-social-*.test.ts', 'src/__tests__/social-monitoring-*.test.ts', 'src/auth.ts', 'src/components/social/monitoring-profile-list.tsx', 'src/components/social/monitoring-source-watchlist.tsx', 'src/lib/social/**', 'src/lib/prisma.ts', 'src/lib/rls-context.ts', 'src/lib/with-rls.ts', '.github/workflows/social-monitoring-queue-e2e.yml']
social = any((fnmatch.fnmatchcase(n, pattern) for n in names for pattern in social_paths)) or any((n.startswith('ops/azure/') for n in names))
report = {'sha': sha, 'base': base, 'head': head, 'heavy': heavy, 'social': social, 'reason': reason, 'fileCount': len(names)}
p = Path(os.environ['BUILD_ARTIFACTSTAGINGDIRECTORY'])
p.mkdir(parents=True, exist_ok=True)
(p / 'candidate.json').write_text(json.dumps(report, indent=2) + '\n')
for key, val in [('LD_HEAVY', str(heavy).lower()), ('LD_SOCIAL', str(social).lower()), ('LD_BASE_SHA', base), ('LD_HEAD_SHA', head)]:
    print(f'##vso[task.setvariable variable={key};isReadOnly=true]{val}')
print(json.dumps(report))
