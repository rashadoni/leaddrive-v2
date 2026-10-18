import { validateFundCanaryRead, validateFundCanaryScope } from './operator-fund-canary.mjs'
const check = value => { if (!value) throw new Error('FUND_CANARY_READ_INVALID') }

/** Inactive restricted DB adapter. Trusted server composition supplies an
 * independently authorized opt-in scope and an actual transaction factory
 * resolving only after COMMIT. No credentials/env fallback or API wiring.
 * Source heads must match each row within the snapshot. This is not a broker,
 * lease, source-write barrier, or proof of reducer correctness.
 */
export async function readFundCanary(database,input) {
  try {
    const scope=validateFundCanaryScope(input)
    check(typeof scope.expectedReaderRole==='string' && /^[a-z_][a-z0-9_]{0,62}$/.test(scope.expectedReaderRole))
    check(typeof database?.$transaction==='function')
    return await database.$transaction(async tx=>{
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
      const roles=await tx.$queryRawUnsafe(`SELECT current_user::text AS current_role, session_user::text AS session_role,
        NOT (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication) AS restricted
        FROM pg_catalog.pg_roles WHERE rolname=current_user`)
      check(roles.length===1 && roles[0].restricted===true && roles[0].current_role===scope.expectedReaderRole && roles[0].session_role===scope.expectedReaderRole)
      const profile=await tx.$queryRawUnsafe(`SELECT count(*)::int AS count,
        bool_and(c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity
          AND NOT pg_has_role(current_user,c.relowner,'MEMBER')
          AND NOT has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          AND NOT has_any_column_privilege(current_user,c.oid,'INSERT,UPDATE,REFERENCES')) AS safe
        FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname IN ('projection_activations','projection_builds','fund_balance_projections','event_aggregate_heads')`)
      check(profile.length===1 && profile[0].count===4 && profile[0].safe===true)
      await tx.$queryRawUnsafe("SELECT set_config('app.org_id',$1,true),set_config('statement_timeout','5s',true),set_config('lock_timeout','2s',true)",scope.organizationId)
      const result=await tx.$queryRawUnsafe(`SELECT jsonb_build_object(
        'pointer',jsonb_build_object('organizationId',a."organizationId",'projectionName',a."projectionName",'activeBuildId',a."activeBuildId",'activationVersion',a."activationVersion"::text),
        'build',jsonb_build_object('organizationId',b."organizationId",'id',b.id,'projectionName',b."projectionName",'buildKey',b."buildKey",'projectionVersion',b."projectionVersion",'codeSha',b."codeSha",'mode',b.mode,'status',b.status,'effectsFenced',b."effectsFenced",'replayFrom',b."replayFrom",'replayTo',b."replayTo"),
        'rows',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM (
          SELECT p."organizationId",p."fundId",b.id AS "buildId",p."buildKey",p."projectionVersion",p.status,p.balance::text AS balance,p.currency,p."aggregateVersion"::text AS "aggregateVersion",p."lastEventId"
          FROM public.fund_balance_projections p
          JOIN public.event_aggregate_heads h ON h."organizationId"=p."organizationId" AND h."aggregateType"='fund' AND h."aggregateId"=p."fundId"
            AND h."currentVersion"=p."aggregateVersion" AND h."lastEventId"=p."lastEventId"
          WHERE p."organizationId"=b."organizationId" AND p."buildKey"=b."buildKey" AND p."projectionVersion"=b."projectionVersion"
          ORDER BY p."fundId" LIMIT 201
        ) r),'[]'::jsonb)) AS snapshot
        FROM public.projection_activations a JOIN public.projection_builds b ON b."organizationId"=a."organizationId" AND b.id=a."activeBuildId"
        WHERE a."organizationId"=$1 AND a."projectionName"='finance.fund-balance'`,scope.organizationId)
      check(result.length===1 && Buffer.byteLength(JSON.stringify(result[0]))<=262144)
      return validateFundCanaryRead(scope,result[0].snapshot)
    },{isolationLevel:'RepeatableRead',maxWait:2000,timeout:10000})
  } catch { throw new Error('FUND_CANARY_READ_INVALID') }
}
