import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { identity, plan, sourceContractSql, cloneProofSql } from './native-scratch-template.mjs'

const nonce = 'a'.repeat(32), args = ['123456', '654321', '123456789', nonce]
const controller = readFileSync(new URL('./commission-production-backup.sh', import.meta.url), 'utf8')

test('only bounded distinct numeric clusters and a fresh nonce-bound name enter SQL', () => {
  const { name, marker } = identity(args[2], nonce)
  assert(name.length <= 63)
  assert(marker.includes(nonce))
  for (const action of ['create', 'bootstrap', 'seal', 'drop']) {
    const sql = plan(action, ...args)
    for (const value of ["current_setting('port')='55432'", "current_user='postgres'", ...args.slice(0, 2), name]) assert(sql.includes(value))
    assert(!/CASCADE|REASSIGN|DROP DATABASE IF EXISTS|DROP ROLE|ALTER SYSTEM|pg_authid|UPDATE pg_/.test(sql))
  }
  for (const bad of ["x';", '', '0', '1'.repeat(21)]) assert.throws(() => plan('create', bad, ...args.slice(1)))
  assert.throws(() => plan('drop', args[0], args[0], args[2], nonce))
  assert.throws(() => identity('1', "a';"))
})

test('pristine template0 is explicit UTF8/libc; unknown old templates and NULL ownership refuse', () => {
  const create = plan('create', ...args), drop = plan('drop', ...args)
  assert(create.includes('TEMPLATE template0'))
  assert(create.includes("ENCODING 'UTF8' LOCALE_PROVIDER libc LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8'"))
  assert(create.includes("datname ~ '^leaddrive_restore_template_'"))
  assert(drop.includes('shobj_description'))
  assert(drop.includes("r.rolname IN ('postgres','leaddrive_restore_verifier')) IS NOT TRUE"))
  assert(create.includes('IS NOT TRUE'))
})

test('temporary extension privilege cannot commit SUPERUSER and direct connections seal separately', () => {
  const sql = plan('bootstrap', ...args)
  assert(sql.startsWith('BEGIN;'))
  assert(sql.indexOf('SUPERUSER;') < sql.indexOf('CREATE EXTENSION vector'))
  assert(sql.indexOf('NOSUPERUSER;') < sql.indexOf('COMMIT;'))
  assert(sql.includes('DROP EXTENSION plpgsql RESTRICT;'))
  for (const pair of [['btree_gist', '1.7'], ['pgcrypto', '1.3'], ['plpgsql', '1.0'], ['vector', '0.6.0']]) {
    assert(sourceContractSql.includes(pair.join("','")))
    assert(cloneProofSql.includes(pair.join("','")))
  }
  assert(plan('seal', ...args).includes("current_database()='postgres'"))
  assert(plan('seal', ...args).includes('ALLOW_CONNECTIONS false'))
  assert(cloneProofSql.includes('r.rolname=session_user'))
  assert(cloneProofSql.includes('NOT rolbypassrls'))
})

test('controller admits before preparing, selects by argument, preserves expiry and never starts during cleanup', () => {
  assert(controller.indexOf('\n  start_commission_scratch\n  prepare_commission_scratch_template\n') > 0)
  assert(controller.includes('executable_args=(--scratch-template "$SCRATCH_TEMPLATE"'))
  assert(controller.includes("^leaddrive_restore_(verify|template)_"))
  const drop = controller.match(/^drop_commission_scratch_template\(\) \{[\s\S]*?^\}/m)[0]
  assert(drop.includes('assert_owned_scratch_running'))
  assert(!/systemd-run|systemctl start|restart/.test(drop))
  const backup = readFileSync(new URL('./postgres-backup.sh', import.meta.url), 'utf8')
  assert(backup.indexOf('source "$BACKUP_ENV_FILE"') < backup.indexOf('unset VERIFY_PGTEMPLATE'))
  assert(backup.includes('export VERIFY_PGTEMPLATE="$SCRATCH_TEMPLATE_ARG"'))
  const canary = readFileSync(new URL('./postgres-restore-canary.sh', import.meta.url), 'utf8')
  assert(canary.includes('"${TEMPLATE_ARGS[@]}" "$SCRATCH_DB"'))
  assert.equal((canary.match(/^prove_native_clone$/gm) ?? []).length, 2)
  assert(canary.includes('pg_restore --exit-on-error --no-owner --no-privileges'))
})

test('CLI rejects malformed/private input without printing it', () => {
  const result = spawnSync(process.execPath, [new URL('./native-scratch-template.mjs', import.meta.url).pathname,
    '--plan', 'create', 'private-token', ...args.slice(1)], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, 'native scratch template plan refused\n')
})
