// SQL planner for a NEW, private, networkless owner-workbench cluster only.
// Not a production admission/provisioning tool. Native production adoption
// still needs its independent source-SID, owned-unit and maintenance fences.
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const role = 'owner_restore_verifier'
export const requiredExtensions = Object.freeze({ btree_gist: '1.7', pgcrypto: '1.3', plpgsql: '1.0', vector: '0.6.0' })
const expected = Object.entries(requiredExtensions)
const cleanRole = `rolcanlogin AND rolcreatedb AND NOT rolsuper AND NOT rolcreaterole
  AND NOT rolinherit AND NOT rolreplication AND NOT rolbypassrls
  AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid=r.oid OR member=r.oid)`
const localePredicate = `pg_catalog.pg_encoding_to_char(d.encoding)='UTF8' AND d.datlocprovider='c'
  AND d.datcollate='C.UTF-8' AND d.datctype='C.UTF-8' AND d.daticulocale IS NULL
  AND d.datcollversion IS NULL AND pg_catalog.pg_database_collation_actual_version(d.oid) IS NULL`
const extensionPredicate = expected.map(([name, version]) =>
  `('${name}','${version}','${name === 'plpgsql' ? 'pg_catalog' : 'public'}')`).join(',')

export function bootstrapSql(systemIdentifier) {
  if (!/^[1-9][0-9]{0,19}$/.test(systemIdentifier ?? '')) throw Error('INPUT')
  return `BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='5s';
DO $guard$
BEGIN
  IF current_database()<>'template1' OR current_setting('port')<>'55432'
    OR current_setting('server_version_num')::int NOT BETWEEN 160000 AND 169999
    OR (pg_control_system()).system_identifier::text<>'${systemIdentifier}'
    OR NOT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user)
    OR NOT EXISTS (SELECT 1 FROM pg_database d WHERE datname=current_database()
      AND datistemplate AND datallowconn AND ${localePredicate})
    OR NOT EXISTS (SELECT 1 FROM pg_roles r WHERE rolname='${role}' AND ${cleanRole})
    OR (SELECT count(*) FROM pg_extension)<>1
    OR NOT EXISTS (SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
      WHERE e.extname='plpgsql' AND e.extversion='1.0' AND n.nspname='pg_catalog')
    OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%')
    OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname NOT IN ('pg_catalog','information_schema'))
    OR EXISTS (SELECT 1 FROM pg_event_trigger)
    OR (SELECT count(*) FROM (VALUES ${extensionPredicate}) AS required(name,version,schema)
      JOIN pg_available_extension_versions a USING(name,version))<>4
  THEN RAISE EXCEPTION 'OWNER_TEMPLATE_REFUSED'; END IF;
END
$guard$;
-- Privilege changes and extension creation are ONE transaction. No committed
-- superuser grant exists, even on an install error or disconnected client.
ALTER ROLE ${role} SUPERUSER;
SET LOCAL ROLE ${role};
-- A fresh template contains only built-in plpgsql. RESTRICT, never CASCADE:
-- recreate it with the verifier as owner so extension comments can restore.
DROP EXTENSION plpgsql RESTRICT;
CREATE EXTENSION plpgsql WITH SCHEMA pg_catalog VERSION '1.0';
CREATE EXTENSION btree_gist WITH SCHEMA public VERSION '1.7';
CREATE EXTENSION pgcrypto WITH SCHEMA public VERSION '1.3';
CREATE EXTENSION vector WITH SCHEMA public VERSION '0.6.0';
RESET ROLE;
ALTER ROLE ${role} NOSUPERUSER;
DO $proof$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles r WHERE rolname='${role}' AND ${cleanRole})
    OR (SELECT count(*) FROM pg_extension)<>4
    OR (SELECT count(*) FROM (VALUES ${extensionPredicate}) AS required(name,version,schema)
      JOIN pg_extension e ON e.extname=required.name AND e.extversion=required.version
      JOIN pg_namespace n ON n.oid=e.extnamespace AND n.nspname=required.schema
      JOIN pg_roles r ON r.oid=e.extowner AND r.rolname='${role}')<>4
  THEN RAISE EXCEPTION 'OWNER_TEMPLATE_PROOF_FAILED'; END IF;
END
$proof$;
COMMIT;
-- Cloning remains permitted; customer SQL cannot reconnect to this template.
ALTER DATABASE template1 ALLOW_CONNECTIONS false;
`
}

export const verificationSql = `BEGIN READ ONLY;
SET LOCAL search_path=pg_catalog,pg_temp;
SET LOCAL statement_timeout='10s';
SELECT json_build_object(
 'versionNumber',current_setting('server_version_num')::int,
 'encoding',pg_encoding_to_char(d.encoding),'provider',d.datlocprovider::text,
 'collate',d.datcollate,'ctype',d.datctype,'icu',d.daticulocale,
 'recordedVersion',d.datcollversion,'actualVersion',pg_database_collation_actual_version(d.oid),
 'databaseOwnedByVerifier',d.datdba=r.oid,
 'cleanRole',(${cleanRole}),
 'extensions',(SELECT json_agg(json_build_object('name',e.extname,'version',e.extversion,
   'schema',n.nspname,'ownedByVerifier',e.extowner=r.oid) ORDER BY e.extname)
   FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace))
 FROM pg_database d CROSS JOIN pg_roles r
 WHERE d.datname=current_database() AND r.rolname=session_user AND r.rolname='${role}';
COMMIT;`

export function validateClone(value) {
  const names = 'versionNumber,encoding,provider,collate,ctype,icu,recordedVersion,actualVersion,databaseOwnedByVerifier,cleanRole,extensions'
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== names.split(',').sort().join(',') ||
    !Number.isInteger(value.versionNumber) || value.versionNumber < 160000 || value.versionNumber >= 170000 ||
    value.encoding !== 'UTF8' || value.provider !== 'c' || value.collate !== 'C.UTF-8' || value.ctype !== 'C.UTF-8' ||
    value.icu !== null || value.recordedVersion !== null || value.actualVersion !== null ||
    value.databaseOwnedByVerifier !== true || value.cleanRole !== true ||
    !Array.isArray(value.extensions) || value.extensions.length !== 4) throw Error('CLONE_REFUSED')
  const entries = value.extensions
  expected.forEach(([name, version], i) => {
    const entry = entries[i]
    if (!entry || Object.keys(entry).sort().join(',') !== 'name,ownedByVerifier,schema,version' ||
      entry.name !== name || entry.version !== version || entry.schema !== (name === 'plpgsql' ? 'pg_catalog' : 'public') ||
      entry.ownedByVerifier !== true) throw Error('CLONE_REFUSED')
  })
  return true
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length === 4 && process.argv[2] === '--bootstrap-sql') process.stdout.write(bootstrapSql(process.argv[3]))
    else if (process.argv.length === 3 && process.argv[2] === '--verification-sql') process.stdout.write(verificationSql)
    else if (process.argv.length === 3 && process.argv[2] === '--validate-clone') {
      const buffer = Buffer.alloc(16385)
      let length = 0
      while (length < buffer.length) {
        const count = fs.readSync(0, buffer, length, buffer.length - length, null)
        if (!count) break
        length += count
      }
      if (length > 16384) throw Error('INPUT')
      validateClone(JSON.parse(buffer.subarray(0, length)))
      process.stdout.write('owner clone compatibility passed\n')
    } else throw Error('INPUT')
  } catch {
    process.stderr.write('owner template compatibility refused\n')
    process.exitCode = 1
  }
}
