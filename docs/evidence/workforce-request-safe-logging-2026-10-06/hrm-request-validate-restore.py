import hashlib
import json
import pathlib
import sys
import zipfile

archive = pathlib.Path(sys.argv[1])
artifact = json.loads(pathlib.Path(sys.argv[2]).read_text())
expected_head = 'ef5d90010d9b317a493dfe7ae574b1863f3c83fb'
expected_merge = '7b517816410e29d84a03f368954541ca180b79f6'
actual_digest = 'sha256:' + hashlib.sha256(archive.read_bytes()).hexdigest()
assert actual_digest == artifact['digest'], 'artifact digest mismatch'
with zipfile.ZipFile(archive) as z:
    members = [n for n in z.namelist() if n.rsplit('/', 1)[-1] == 'restore-rendered-ui-receipt.json']
    assert len(members) == 1, 'expected one safe receipt member'
    payload = z.read(members[0])
receipt = json.loads(payload)
assert receipt['candidateHead'] == expected_head
assert receipt['checkedMergeSha'] == expected_merge
pathlib.Path('/tmp/hrm-request-restore-attempt1-sanitized.json').write_bytes(payload)
bindings = receipt['sourceBindings']
assert len(bindings) == 34
root = pathlib.Path('/workspace/hrm-request-logging')
for binding in bindings:
    source = root / binding['path']
    assert root in source.resolve().parents
    data = source.read_bytes()
    assert len(data) == binding['bytes'], binding['path']
    assert hashlib.sha256(data).hexdigest() == binding['sha256'], binding['path']
cases = receipt['cases']
summary = {
    'head': expected_head, 'synthetic': expected_merge,
    'artifact_id': artifact['id'], 'artifact_digest_verified': actual_digest,
    'safe_member': members[0], 'other_zip_member_contents_read': False,
    'status': receipt['status'], 'required_cases': receipt['requiredCases'],
    'completed_cases': len(cases), 'unique_case_names': len({x['name'] for x in cases}),
    'case_statuses': [x['status'] for x in cases],
    'cleanup': receipt['cleanup'], 'authentication_records': len(receipt['authentication']),
    'source_bindings_verified': len(bindings),
    'receipt_sha256': hashlib.sha256(payload).hexdigest(),
    'boundary': receipt['boundary'],
}
pathlib.Path('/tmp/hrm-request-restore-attempt1-root.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps(summary, indent=2))
assert receipt['status'] == 'PASS' and receipt['failure'] is None
assert receipt['requiredCases'] == 15 and len(cases) == 15
assert len({x['name'] for x in cases}) == 15
assert all(x['status'] == 'PASS' for x in cases)
assert len(receipt['cleanup']) == 2 and all(x['status'] == 'PASS' for x in receipt['cleanup'])
assert len(receipt['authentication']) == 10
assert all(x['csrfStatus'] == 200 and x['callbackStatus'] == 200 and x['actualPrincipalAndTenant'] is True for x in receipt['authentication'])
