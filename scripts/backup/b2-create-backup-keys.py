#!/usr/bin/env python3
"""Create the two least-privilege B2 application keys for production backups.

Run once by the owner on an administrative machine (not on production):

    python3 scripts/backup/b2-create-backup-keys.py \
        --bucket leaddrive-prod-backups --out ~/leaddrive-b2-keys

The B2 web console only offers "Read and Write", "Read Only" and "Write Only";
none of them is the writer the backup pipeline needs (upload + HEAD + Object
Lock retention, and no delete), so the keys are created through the native API
with an explicit capability list.

The script asks for a key that may create keys (the master application key)
without echoing it, keeps it in memory only, and writes each new key into its
own 0600 file inside a fresh 0700 directory. It prints key IDs and
capabilities, never a secret.

    writer.env   -> AWS_* lines go into /etc/leaddrive/backup.env during the
                    reviewed commissioning; nowhere else.
    restore.env  -> offline only (password manager / restore-drill machine);
                    never on production, in CI or in Git.
"""

import argparse
import base64
import getpass
import json
import os
import re
import sys
import urllib.error
import urllib.request

API = "https://api.backblazeb2.com/b2api/v2"

WRITER_NAME = "leaddrive-prod-backup-writer"
RESTORE_NAME = "leaddrive-prod-backup-restore"

# HEAD needs readFiles; the retention extension after each upload needs
# readFileRetentions + writeFileRetentions; the Object Lock preflight needs
# readBucketRetentions. No deleteFiles, no bypassGovernance, no key or bucket
# administration, no listing of other buckets.
WRITER_CAPABILITIES = [
    "listBuckets",
    "readBucketEncryption",
    "readBucketRetentions",
    "writeFiles",
    "readFiles",
    "readFileRetentions",
    "writeFileRetentions",
]
RESTORE_CAPABILITIES = [
    "listBuckets",
    "readBucketEncryption",
    "readBucketRetentions",
    "listFiles",
    "readFiles",
    "readFileRetentions",
]


def fail(message):
    print(f"FATAL: {message}", file=sys.stderr)
    sys.exit(1)


def call(url, payload=None, token=None, basic=None):
    data = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(url, data=data, method="POST" if data else "GET")
    if token:
        request.add_header("Authorization", token)
    if basic:
        request.add_header("Authorization", "Basic " + base64.b64encode(basic.encode()).decode())
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        try:
            body = json.load(error)
            code = body.get("code", "unknown")
        except Exception:
            code = "unknown"
        # The error body never contains the key; only the code is printed.
        fail(f"{url.rsplit('/', 1)[-1]} refused: HTTP {error.code} {code}")


def write_env(path, values):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as handle:
        for key, value in values.items():
            handle.write(f"{key}={value}\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--out", required=True, help="new directory for writer.env and restore.env")
    args = parser.parse_args()

    out = os.path.abspath(os.path.expanduser(args.out))
    if os.path.exists(out):
        fail(f"{out} already exists; choose a new directory")

    key_id = input("Admin key ID (master application key): ").strip()
    key = getpass.getpass("Admin application key (not echoed): ").strip()
    if not key_id or not key:
        fail("both the key ID and the key are required")

    auth = call(f"{API}/b2_authorize_account", basic=f"{key_id}:{key}")
    del key
    account_id = auth["accountId"]
    api_url = auth["apiUrl"] + "/b2api/v2"
    token = auth["authorizationToken"]
    s3_url = auth.get("s3ApiUrl", "")
    match = re.fullmatch(r"https://s3\.([a-z]{2}-[a-z]+-[0-9]{3})\.backblazeb2\.com", s3_url)
    if not match:
        fail("account did not report a recognised B2 S3 endpoint")
    region = match.group(1)

    buckets = call(f"{api_url}/b2_list_buckets", {"accountId": account_id, "bucketName": args.bucket}, token)["buckets"]
    if len(buckets) != 1:
        fail(f"bucket {args.bucket} not found in this account")
    bucket = buckets[0]
    if bucket.get("bucketType") != "allPrivate":
        fail(f"bucket {args.bucket} is not private")
    encryption = (bucket.get("defaultServerSideEncryption") or {}).get("value") or {}
    lock = ((bucket.get("fileLockConfiguration") or {}).get("value") or {})
    print(f"bucket {args.bucket}: private, region {region}, "
          f"default encryption {encryption.get('mode') or 'none'}, "
          f"object lock {'enabled' if lock.get('isFileLockEnabled') else 'disabled'}")

    existing = call(f"{api_url}/b2_list_keys", {"accountId": account_id, "maxKeyCount": 1000}, token)["keys"]
    clash = sorted({k["keyName"] for k in existing} & {WRITER_NAME, RESTORE_NAME})
    if clash:
        fail(f"keys already exist: {', '.join(clash)}; delete them in the console first")

    os.makedirs(out, mode=0o700)
    endpoint = f"https://s3.{region}.backblazeb2.com"
    for name, capabilities, filename in (
        (WRITER_NAME, WRITER_CAPABILITIES, "writer.env"),
        (RESTORE_NAME, RESTORE_CAPABILITIES, "restore.env"),
    ):
        created = call(f"{api_url}/b2_create_key", {
            "accountId": account_id,
            "keyName": name,
            "capabilities": capabilities,
            "bucketId": bucket["bucketId"],
        }, token)
        write_env(os.path.join(out, filename), {
            "BACKUP_S3_ENDPOINT": endpoint,
            "BACKUP_S3_REGION": region,
            "BACKUP_S3_BUCKET": args.bucket,
            "AWS_ACCESS_KEY_ID": created["applicationKeyId"],
            "AWS_SECRET_ACCESS_KEY": created["applicationKey"],
        })
        granted = ",".join(sorted(created.get("capabilities", [])))
        print(f"created {name}: keyId {created['applicationKeyId']} bucket-restricted, capabilities {granted}")
        print(f"  secret written to {os.path.join(out, filename)} (0600)")

    print("Next: bash scripts/backup/b2-verify-backup-keys.sh "
          f"{os.path.join(out, 'writer.env')} {os.path.join(out, 'restore.env')}")


if __name__ == "__main__":
    main()
