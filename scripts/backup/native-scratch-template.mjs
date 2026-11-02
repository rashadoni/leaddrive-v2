// SQL planning only. The native controller must independently admit the fixed
// separate PGDATA, held maintenance lock and nonce/InvocationID-owned unit.
// Never execute these plans on a source cluster or reuse the owner-image tool.
import { pathToFileURL } from 'node:url'

const role = 'leaddrive_restore_verifier'
const extensions = [['btree_gist', '1.7', 'public'], ['pgcrypto', '1.3', 'public'],
  ['plpgsql', '1.0', 'pg_catalog'], ['vector', '0.6.0', 'public']]
const required = extensions.map(e => `('${e.join("','")}')`).join(',')
const cleanRole = `rolcanlogin AND rolcreatedb AND NOT rolsuper AND NOT rolcreaterole
 AND NOT rolinherit AND NOT rolreplication AND NOT rolbypassrls
 AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid=r.oid OR member=r.oid)`
const locale = `pg_encoding_to_char(d.encoding)='UTF8' AND d.datlocprovider='c'
 AND d.datcollate='C.UTF-8' AND d.datctype='C.UTF-8' AND d.daticulocale IS NULL
 AND d.datcollversion IS NULL AND pg_database_collation_actual_version(d.oid) IS NULL`
const exactExtensions = `(SELECT count(*) FROM pg_extension)=4 AND
 (SELECT count(*) FROM (VALUES ${required}) AS required(name,version,schema)
 JOIN pg_extension e ON e.extname=required.name AND e.extversion=required.version
 JOIN pg_namespace n ON n.oid=e.extnamespace AND n.nspname=required.schema)=4`
const ownedExtensions = `(SELECT count(*) FROM pg_extension e JOIN pg_roles r ON r.oid=e.extowner
 WHERE r.rolname='${role}')=4`

export function identity(run, nonce) {
  if (!/^[1-9][0-9]{0,19}$/.test(run ?? '') || !/^[0-9a-f]{32}$/.test(nonce ?? '')) throw Error('INPUT')
  return { name: `leaddrive_restore_template_${run}_${nonce.slice(0, 12)}`,
    marker: `LeadDrive native template ${run} ${nonce}` }
}
function guard(target, source, database) {
  if (![target, source].every(v => /^[1-9][0-9]{0,19}$/.test(v ?? '')) || target === source) throw Error('IDENTITY')
  return `current_database()='${database}' AND current_setting('port')='55432'
 AND current_setting('server_version_num')::int BETWEEN 160000 AND 169999
 AND (pg_control_system()).system_identifier::text='${target}'
 AND (pg_control_system()).system_identifier::text<>'${source}'
 AND current_user='postgres' AND (SELECT rolsuper FROM pg_roles WHERE rolname=current_user)
 AND EXISTS (SELECT 1 FROM pg_roles r WHERE rolname='${role}' AND ${cleanRole})`
}
const settings = `SET search_path=pg_catalog,pg_temp;
SET statement_timeout='20s';
SET lock_timeout='5s';
`
function check(predicate) {
  return `DO $guard$ BEGIN IF (${predicate}) IS NOT TRUE THEN RAISE EXCEPTION 'NATIVE_TEMPLATE_REFUSED'; END IF; END $guard$;\n`
}
export const sourceContractSql = `SELECT coalesce((
 current_setting('server_version_num')::int BETWEEN 160000 AND 169999
 AND ${locale} AND ${exactExtensions}),false)::int
 FROM pg_database d WHERE d.datname=current_database();`

export function plan(action, target, source, run, nonce) {
  const { name, marker } = identity(run, nonce)
  const maintenance = guard(target, source, 'postgres')
  const owned = `d.datname='${name}' AND NOT d.datistemplate
 AND shobj_description(d.oid,'pg_database')='${marker}'`
  if (action === 'create') return settings + check(`${maintenance}
 AND NOT EXISTS (SELECT 1 FROM pg_database WHERE datname ~ '^leaddrive_restore_template_')
 AND (SELECT count(*) FROM (VALUES ${required}) AS required(name,version,schema)
 JOIN pg_available_extension_versions a USING(name,version))=4`) +
    `CREATE DATABASE ${name} WITH OWNER postgres TEMPLATE template0
 ENCODING 'UTF8' LOCALE_PROVIDER libc LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8';
COMMENT ON DATABASE ${name} IS '${marker}';\n`
  if (action === 'bootstrap') return `BEGIN;\n` + settings + check(`${guard(target, source, name)}
 AND EXISTS (SELECT 1 FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba
 WHERE ${owned} AND r.rolname='postgres' AND d.datallowconn AND ${locale})
 AND (SELECT count(*) FROM pg_extension)=1
 AND EXISTS (SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
 WHERE e.extname='plpgsql' AND e.extversion='1.0' AND n.nspname='pg_catalog')
 AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%')
 AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname NOT IN ('pg_catalog','information_schema'))
 AND NOT EXISTS (SELECT 1 FROM pg_event_trigger)`) +
    `ALTER ROLE ${role} SUPERUSER;
SET LOCAL ROLE ${role};
DROP EXTENSION plpgsql RESTRICT;
CREATE EXTENSION plpgsql WITH SCHEMA pg_catalog VERSION '1.0';
CREATE EXTENSION btree_gist WITH SCHEMA public VERSION '1.7';
CREATE EXTENSION pgcrypto WITH SCHEMA public VERSION '1.3';
CREATE EXTENSION vector WITH SCHEMA public VERSION '0.6.0';
RESET ROLE;
ALTER ROLE ${role} NOSUPERUSER;
ALTER DATABASE ${name} OWNER TO ${role};
` + check(`${guard(target, source, name)} AND ${exactExtensions} AND ${ownedExtensions}`) + `COMMIT;\n`
  if (action === 'seal') return settings + check(`${maintenance}
 AND EXISTS (SELECT 1 FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba
 WHERE ${owned} AND r.rolname='${role}' AND d.datallowconn AND ${locale})`) +
    `ALTER DATABASE ${name} ALLOW_CONNECTIONS false;\n`
  if (action === 'drop') return settings + check(`${maintenance}
 AND NOT EXISTS (SELECT 1 FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba
 WHERE d.datname='${name}' AND ((${owned}) AND r.rolname IN ('postgres','${role}')) IS NOT TRUE)`)
    + `SELECT 'DROP DATABASE ${name}' WHERE EXISTS (SELECT 1 FROM pg_database WHERE datname='${name}')\n\\gexec
SELECT count(*) FROM pg_database WHERE datname='${name}';\n`
  throw Error('INPUT')
}

// Runs as the real limited verifier, before and after a full strict restore.
export const cloneProofSql = `BEGIN READ ONLY;
SET LOCAL search_path=pg_catalog,pg_temp;
SET LOCAL statement_timeout='10s';
SELECT coalesce((${locale} AND ${exactExtensions} AND ${ownedExtensions}
 AND d.datdba=r.oid AND ${cleanRole}),false)::int
 FROM pg_database d CROSS JOIN pg_roles r
 WHERE d.datname=current_database() AND r.rolname=session_user AND r.rolname='${role}';
COMMIT;`

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2)
    if (args.length === 1 && args[0] === '--source-contract-sql') process.stdout.write(sourceContractSql)
    else if (args.length === 1 && args[0] === '--clone-proof-sql') process.stdout.write(cloneProofSql)
    else if (args.length === 6 && args[0] === '--plan') process.stdout.write(plan(...args.slice(1)))
    else throw Error('INPUT')
  } catch {
    process.stderr.write('native scratch template plan refused\n')
    process.exitCode = 1
  }
}
