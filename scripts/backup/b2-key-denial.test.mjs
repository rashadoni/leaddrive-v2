import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const source = readFileSync('scripts/backup/b2-verify-backup-keys.sh', 'utf8');
const helper = source.match(/^expect_denied\(\) \{\n[\s\S]*?^\}/m)?.[0];
assert.ok(helper);
for (const [name, code, message, expected] of [
 ['explicit policy denial', 254, 'An error occurred (AccessDenied) when calling PutObject: raw-secret', 0],
 ['network failure', 255, 'Could not connect: raw-secret', 1],
 ['expired credentials', 254, 'An error occurred (ExpiredToken) when calling PutObject: raw-secret', 1],
 ['signature failure', 254, 'An error occurred (SignatureDoesNotMatch) when calling PutObject: raw-secret', 1],
 ['timeout', 124, '', 1],
 ['unexpected permission', 0, '', 1],
]) test(name, () => {
 const dir = mkdtempSync(join(tmpdir(), 'b2-denial-'));
 try {
  const script = `WORK="$1"\nFAILURES=0\npass() { echo "PASS $1"; }\nfailed() { echo "FAIL $1"; FAILURES=$((FAILURES + 1)); }\nerror_code() { grep -oE '\\(([A-Za-z]+)\\)' "$WORK/stderr" | head -1 | tr -d '()' || true; }\n${helper}\nprobe() { printf '%s' "$2" >"$WORK/stderr"; return "$1"; }\nexpect_denied "restore upload" probe "$2" "$3"\nexit "$FAILURES"\n`;
  const r = spawnSync('bash', ['-c', script, 'probe', dir, String(code), message], { encoding: 'utf8' });
  assert.equal(r.status, expected, r.stdout + r.stderr);
  assert.ok(!(r.stdout + r.stderr).includes('raw-secret'));
 } finally { rmSync(dir, {recursive:true,force:true}); }
});
