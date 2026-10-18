import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
const query = await readFile(new URL('./operator-fund-snapshot.sql', import.meta.url), 'utf8')
const check = value => { if (!value) throw new Error('FUND_RECOVERY_SNAPSHOT_INVALID') }
const identity = value => typeof value === 'string' && /^[^\s:\u0000-\u001f\u007f]{1,191}$/.test(value)
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
const unsigned = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value)<=9223372036854775807n
const digest = value => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
const limits = Object.freeze({ funds: 200, events: 1000, checkpoints: 128, bytes: 1048576 })

/** Inactive read-only DB evidence producer. No broker, consumer, effects or
 * pointer writes. database must own a REAL transaction, resolving after COMMIT.
 * reduceFundBalance must be the existing pinned production pure reducer, supplied
 * by trusted server composition, never an operator-provided function/module.
 * RLS needs independently provisioned tenant/build restrictions: app.org_id is
 * context, not authorization. No provisioning/credential/default-role fallback.
 */
export async function collectFundRecoveryDatabaseSnapshot(database, input, reduceFundBalance) {
  try {
    const scope = Object.freeze({ ...input, fundIds:Object.freeze([...(input?.fundIds ?? [])]) })
    check(identity(scope.organizationId) && uuid(scope.buildId) && identity(scope.buildKey))
    check(typeof scope.environment==='string' && /^[a-z][a-z0-9]{0,31}$/.test(scope.environment))
    check(scope.fundIds.length>0 && scope.fundIds.length<=limits.funds && new Set(scope.fundIds).size===scope.fundIds.length && scope.fundIds.every(identity))
    check(Number.isSafeInteger(scope.projectionVersion) && scope.projectionVersion >= 2)
    check(typeof scope.codeSha === 'string' && /^[0-9a-f]{40}$/.test(scope.codeSha))
    check(typeof scope.expectedReaderRole === 'string' && /^[a-z_][a-z0-9_]{0,62}$/.test(scope.expectedReaderRole))
    check(typeof reduceFundBalance === 'function' && typeof database?.$transaction === 'function')
    return await database.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
      const roles = await tx.$queryRawUnsafe(`SELECT current_user::text AS current_role,session_user::text AS session_role,
        NOT (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication) AS restricted
        FROM pg_catalog.pg_roles WHERE rolname=current_user`)
      check(roles.length===1 && roles[0].restricted===true && roles[0].current_role===scope.expectedReaderRole && roles[0].session_role===scope.expectedReaderRole)
      const access = await tx.$queryRawUnsafe(`SELECT count(*)::int AS count,
        bool_and(c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity
          AND NOT pg_has_role(current_user,c.relowner,'MEMBER')
          AND NOT has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          AND NOT has_any_column_privilege(current_user,c.oid,'INSERT,UPDATE,REFERENCES')) AS safe
        FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname IN ('funds','domain_events','event_outbox','event_aggregate_heads',
          'fund_balance_projections','projection_builds','projection_checkpoints','consumer_inbox','effect_outbox')`)
      check(access.length===1 && access[0].count===9 && access[0].safe===true)
      await tx.$queryRawUnsafe("SELECT set_config('app.org_id',$1,true),set_config('statement_timeout','5s',true),set_config('lock_timeout','2s',true)", scope.organizationId)
      const result = await tx.$queryRawUnsafe(query, scope.organizationId, scope.buildId, limits.funds+1, limits.events+1, limits.checkpoints+1)
      check(result.length===1)
      const raw = result[0].snapshot
      check(raw && Buffer.byteLength(JSON.stringify(raw))<=limits.bytes && raw.nonLiveEffectPresent===false)
      check(typeof raw.observedAt==='string' && new Date(raw.observedAt).toISOString()===raw.observedAt)
      check(typeof raw.databaseSnapshot==='string' && /^\d+:\d+:(?:\d+(?:,\d+)*)?$/.test(raw.databaseSnapshot))
      check(Array.isArray(raw.builds) && raw.builds.length===1)
      const b = raw.builds[0]
      check(b.id===scope.buildId && b.org===scope.organizationId && b.projection==='finance.fund-balance' && b.version===scope.projectionVersion &&
        b.key===scope.buildKey && b.sha===scope.codeSha && b.mode==='shadow' && b.fenced===true &&
        ['running','verifying','ready','promoted'].includes(b.status) && b.replay_from===null && b.replay_to===null)
      for (const name of ['funds','heads','active','shadow']) check(Array.isArray(raw[name]) && raw[name].length>0 && raw[name].length<=limits.funds)
      check(Array.isArray(raw.events) && raw.events.length>0 && raw.events.length<=limits.events)
      check(Array.isArray(raw.checkpoints) && raw.checkpoints.length>0 && raw.checkpoints.length<=limits.checkpoints)
      check(Array.isArray(raw.inbox) && raw.inbox.length===raw.events.length)
      const states = new Map(), histories = new Map(), eventIds = new Set(), events = new Map()
      for (const event of raw.events) {
        check(event.integrity===true && uuid(event.id) && !eventIds.has(event.id) && identity(event.fund) && unsigned(event.version) && hash(event.data_hash) && hash(event.outbox_hash))
        eventIds.add(event.id); events.set(event.id,event)
        check(event.envelope?.organizationid===scope.organizationId && event.envelope.aggregateid===event.fund &&
          event.envelope.id===event.id && String(event.envelope.aggregateversion)===event.version && event.envelope.type===event.type)
        const previous = states.get(event.fund) ?? null
        const next = reduceFundBalance(previous,event.envelope)
        check(next.organizationId===scope.organizationId && next.fundId===event.fund && next.lastEventId===event.id && String(next.aggregateVersion)===event.version)
        states.set(event.fund,next)
        if (!histories.has(event.fund)) histories.set(event.fund,[])
        histories.get(event.fund).push([event.version,event.id,event.data_hash,event.outbox_hash])
      }
      const indexed = (rows,key) => {
        const map = new Map()
        for (const row of rows) { check(identity(row[key]) && !map.has(row[key])); map.set(row[key],row) }
        check(map.size===states.size)
        return map
      }
      check(states.size===scope.fundIds.length && scope.fundIds.every(fund=>states.has(fund)))
      const funds=indexed(raw.funds,'id'), heads=indexed(raw.heads,'fund'), active=indexed(raw.active,'fund'), shadow=indexed(raw.shadow,'fund')
      const source=[], target=[]
      for (const [fundId,state] of states) {
        const f=funds.get(fundId), h=heads.get(fundId), a=active.get(fundId), s=shadow.get(fundId)
        check(f && h && a && s && s.status==='shadow')
        check(s.evidence_last_event===state.lastEventId && s.evidence_last_at===state.lastEventAt)
        check(f.balance===state.balance && f.currency===state.currency &&
          h.version===String(state.aggregateVersion) && h.last_event===state.lastEventId)
        for (const p of [a,s]) check(p.balance===state.balance && p.currency===state.currency && p.version===String(state.aggregateVersion) && p.last_event===state.lastEventId)
        const row = Object.freeze({ aggregateId:fundId,eventCount:String(histories.get(fundId).length),aggregateVersion:String(state.aggregateVersion),
          historyHash:digest(histories.get(fundId)),stateHash:digest([scope.organizationId,fundId,state.balance,state.currency,String(state.aggregateVersion),state.lastEventId,state.lastEventAt]),balance:state.balance,currency:state.currency })
        source.push(row); target.push(Object.freeze({...row}))
      }
      const inboxIds=new Set(), positions=new Set(), maxima=new Map()
      for (const receipt of raw.inbox) {
        const event=events.get(receipt.event)
        check(event && !inboxIds.has(receipt.event) && receipt.type===event.type && receipt.hash===event.outbox_hash)
        inboxIds.add(receipt.event)
        check(receipt.topic===`ld.${scope.environment}.finance.events.v1` &&
          Number.isInteger(receipt.partition) && receipt.partition>=0 && receipt.partition<128 && unsigned(receipt.offset))
        const key=`${receipt.topic}:${receipt.partition}`, position=`${key}:${receipt.offset}`
        check(!positions.has(position)); positions.add(position)
        if (!maxima.has(key) || BigInt(maxima.get(key))<BigInt(receipt.offset)) maxima.set(key,receipt.offset)
      }
      const partitions=new Set(), checkpoints=[]
      for (const c of raw.checkpoints) {
        check(c.topic===`ld.${scope.environment}.finance.events.v1` &&
          Number.isInteger(c.partition) && c.partition>=0 && c.partition<128 && unsigned(c.last_offset) && BigInt(c.last_offset)<9223372036854775807n && uuid(c.last_event) && eventIds.has(c.last_event))
        const key=`${c.topic}:${c.partition}`; check(!partitions.has(key) && maxima.has(key) && BigInt(c.last_offset)>=BigInt(maxima.get(key))); partitions.add(key)
        checkpoints.push(Object.freeze({ topic:c.topic,partition:c.partition,lastOffset:c.last_offset,nextOffset:String(BigInt(c.last_offset)+1n),lastEventId:c.last_event }))
      }
      check(partitions.size===maxima.size)
      return Object.freeze({ kind:'FundRecoveryDatabaseSnapshot',organizationId:scope.organizationId,buildId:scope.buildId,
        codeSha:scope.codeSha,observedAt:raw.observedAt,databaseSnapshot:raw.databaseSnapshot,source:Object.freeze(source),shadow:Object.freeze(target),checkpoints:Object.freeze(checkpoints),
        brokerPositionsAuthenticated:false,externalEvidenceVerified:false })
    },{isolationLevel:'RepeatableRead',maxWait:2000,timeout:10000})
  } catch { throw new Error('FUND_RECOVERY_SNAPSHOT_INVALID') }
}
