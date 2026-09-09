#!/usr/bin/env python3
"""Verify a successful main build's files before making a production connection."""
import hashlib, json, os, re, subprocess, tarfile
from pathlib import Path, PurePosixPath
sha = os.environ['DEPLOY_TARGET_SHA']
if not re.fullmatch('[0-9a-f]{40}', sha):
    raise RuntimeError('Delivery admission condition failed')
root = Path(os.environ['LD_RELEASE_DIRECTORY'])
names = [f'leaddrive-prod-{sha}.tar.gz', 'server-deploy.sh', 'release-source.json']
if not not any((p.is_symlink() for p in root.rglob('*'))):
    raise RuntimeError('Symlink in downloaded artifacts')
lines = (root / 'SHA256SUMS').read_text().splitlines()
if not len(lines) == len(names):
    raise RuntimeError('Delivery admission condition failed')
expected = {}
for line in lines:
    digest, name = line.split('  ', 1)
    if not (re.fullmatch('[0-9a-f]{64}', digest) and name in names and (name not in expected)):
        raise RuntimeError('Delivery admission condition failed')
    expected[name] = digest
for name in names:
    p = root / name
    if not (p.is_file() and p.stat().st_size > 0):
        raise RuntimeError('Delivery admission condition failed')
    h = hashlib.sha256()
    with p.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    if not h.hexdigest() == expected[name]:
        raise RuntimeError(f'Artifact checksum mismatch: {name}')
script = subprocess.check_output(['git', 'show', sha + ':scripts/server-deploy.sh'])
if not hashlib.sha256(script).hexdigest() == expected['server-deploy.sh']:
    raise RuntimeError('Deploy script is not from the admitted revision')
source = json.loads((root / 'release-source.json').read_text())
if not (source['buildId'] == os.environ['LD_RELEASE_RUN'] and source['sha'] == sha):
    raise RuntimeError('Wrong source build in release artifact')
with tarfile.open(root / names[0], 'r:gz') as tar:
    markers = []
    for member in tar:
        path = PurePosixPath(member.name)
        if not (not path.is_absolute() and '..' not in path.parts):
            raise RuntimeError('Unsafe archive path')
        if not (not member.isdev() and (not member.isfifo())):
            raise RuntimeError('Special file in archive')
        if str(path) == '.deploy-sha':
            if not (member.isfile() and member.size < 100):
                raise RuntimeError('Delivery admission condition failed')
            markers.append(tar.extractfile(member).read().decode().strip())
    if not markers == [sha]:
        raise RuntimeError('Archive revision marker mismatch')
print('Verified archive and deployment script for ' + sha)
