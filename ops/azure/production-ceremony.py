#!/usr/bin/env python3
"""Serialize promotion and every post-deploy check, releasing on agent disconnect."""
import os, selectors, subprocess, time, json
from pathlib import Path
host = os.environ['SERVER_HOST']
user = os.environ['SERVER_USER']
sha = os.environ['DEPLOY_TARGET_SHA']
if not (host == '13.140.132.245' and user == 'root'):
    raise RuntimeError('Delivery admission condition failed')
key = str(Path.home() / '.ssh/deploy_key')
target = user + '@' + host
ssh = ['ssh', '-o', 'ConnectTimeout=30', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4', '-i', key]
controller = Path(os.environ['LD_TRUSTED_DEPLOY_DIRECTORY'])
artifact = Path(os.environ['LD_RELEASE_DIRECTORY'])
lease = subprocess.Popen(ssh + [target, "flock -n /run/lock/leaddrive-azure-delivery.lock sh -c 'echo AZURE_LEASE_READY; cat >/dev/null'"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
try:
    selector = selectors.DefaultSelector()
    selector.register(lease.stdout, selectors.EVENT_READ)
    if not selector.select(45):
        raise RuntimeError('Timed out acquiring deployment lease')
    if not lease.stdout.readline().strip() == 'AZURE_LEASE_READY':
        raise RuntimeError('Another deployment owns the production lease')
    selector.close()
    subprocess.run(['python3', str(controller / 'deploy-admission.py')], check=True, timeout=150)
    subprocess.run(['bash', str(controller / 'production-06.sh')], check=True, timeout=300)
    for local, remote in [(artifact / f'leaddrive-prod-{sha}.tar.gz', f'/tmp/leaddrive-deploy-{sha}.tar.gz'), (artifact / 'server-deploy.sh', f'/tmp/server-deploy-{sha}.sh')]:
        subprocess.run(['scp', '-o', 'ConnectTimeout=30', '-i', key, str(local), target + ':' + remote], check=True, timeout=300)
    subprocess.run(['bash', str(controller / 'production-11.sh')], check=True, timeout=2400)
    results = []
    for entry in json.loads((controller / 'production-steps.json').read_text())[2:]:
        if lease.poll() is not None:
            raise RuntimeError('Production lease connection lost')
        try:
            r = subprocess.run(['bash', str(controller / entry['script'])], timeout=300)
            code = r.returncode
        except subprocess.TimeoutExpired:
            code = 124
        results.append({'check': entry['name'], 'exitCode': code})
    receipt = {'sha': sha, 'sourceBuild': os.environ['LD_RELEASE_RUN'], 'checks': results, 'authenticatedBrowserSmoke': 'not_run_credentials_not_configured'}
    out = Path(os.environ['BUILD_ARTIFACTSTAGINGDIRECTORY'])
    out.mkdir(exist_ok=True)
    (out / 'production-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print('##vso[task.logissue type=warning]Authenticated Social Monitoring browser smoke was NOT RUN: dedicated smoke account is not configured. Public and server checks are reported separately.')
    if not all((x['exitCode'] == 0 for x in results)):
        raise RuntimeError('One or more post-deploy checks failed; inspect production-receipt.json')
finally:
    if lease.stdin:
        lease.stdin.close()
    try:
        lease.wait(timeout=15)
    except subprocess.TimeoutExpired:
        lease.terminate()
        try:
            lease.wait(timeout=5)
        except subprocess.TimeoutExpired:
            lease.kill()
            lease.wait()
