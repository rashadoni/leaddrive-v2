const fail = () => { throw new Error('FUND_CANARY_READ_INVALID') }
const require = value => { if (!value) fail() }
const id = value => typeof value === 'string' && /^[^\s:\u0000-\u001f\u007f]{1,191}$/.test(value)
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
const version = value => typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value)<=9223372036854775807n

/** Inactive pure contract, NOT a database reader or authorization boundary.
 * Trusted server composition must obtain pointer/build/rows in ONE restricted
 * read-only transaction, and supply independently authorized scope/inventory.
 * No fallback, API wiring, freshness assertion, or promotion authority.
 */
export function validateFundCanaryRead(scope, snapshot) {
  try {
    require(scope?.enabled===true && id(scope.organizationId) && uuid(scope.buildId) && id(scope.buildKey))
    require(version(scope.pointerVersion) && Number.isSafeInteger(scope.projectionVersion) && scope.projectionVersion>=2)
    require(typeof scope.codeSha==='string' && /^[0-9a-f]{40}$/.test(scope.codeSha))
    require(Array.isArray(scope.fundIds) && scope.fundIds.length>0 && scope.fundIds.length<=200 && scope.fundIds.every(id) && new Set(scope.fundIds).size===scope.fundIds.length)
    const {pointer,build,rows}=snapshot
    require(pointer.organizationId===scope.organizationId && pointer.projectionName==='finance.fund-balance' && pointer.activeBuildId===scope.buildId && pointer.activationVersion===scope.pointerVersion)
    require(build.organizationId===scope.organizationId && build.id===scope.buildId && build.projectionName==='finance.fund-balance' && build.buildKey===scope.buildKey && build.projectionVersion===scope.projectionVersion && build.codeSha===scope.codeSha)
    require(build.mode==='shadow' && build.status==='promoted' && build.effectsFenced===true && build.replayFrom===null && build.replayTo===null)
    require(Array.isArray(rows) && rows.length===scope.fundIds.length)
    const expected=new Set(scope.fundIds), result=[]
    for (const row of rows) {
      require(expected.delete(row.fundId) && row.organizationId===scope.organizationId && row.buildId===scope.buildId && row.buildKey===scope.buildKey && row.projectionVersion===scope.projectionVersion)
      require(row.status==='shadow' && version(row.aggregateVersion) && uuid(row.lastEventId))
      require(typeof row.balance==='string' && /^(0|[1-9][0-9]{0,13})\.[0-9]{4}$/.test(row.balance) && typeof row.currency==='string' && /^[A-Z]{3}$/.test(row.currency))
      result.push(Object.freeze({fundId:row.fundId,balance:row.balance,currency:row.currency,aggregateVersion:row.aggregateVersion,lastEventId:row.lastEventId}))
    }
    require(expected.size===0)
    result.sort((a,b)=>a.fundId<b.fundId?-1:a.fundId>b.fundId?1:0)
    return Object.freeze({organizationId:scope.organizationId,buildId:scope.buildId,pointerVersion:scope.pointerVersion,funds:Object.freeze(result)})
  } catch { fail() }
}
