import { createHash } from 'node:crypto'

const fail = () => { throw new Error('OPERATOR_RECOVERY_EVIDENCE_INVALID') }
const check = condition => { if (!condition) fail() }
const uint = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n
const hash = value => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value)
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)
const instant = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
const decimal = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,13})\.[0-9]{4}$/.test(value)

/** OFFLINE gate, not a worker/controller, signed receipt, or activation authority.
 * raw must be authentic bytes fetched through a trusted read-only adapter.
 * expected is independently trusted controller/DB scope, never HTTP body data.
 * SHA-256 pins exact bytes (not JS canonical JSON or PostgreSQL jsonb text).
 * The future controller must recheck pointer/lease/build and freeze watermark
 * in the SAME restricted transaction as a read-pointer switch.
 */
export function validateOperatorRecoveryEvidence(raw, expected) {
  try {
    check(typeof raw === 'string' && Buffer.byteLength(raw, 'utf8') <= 1048576)
    const { plan, now, maxAgeMs, partitionCount, previousBuildId, minSoakMs } = expected
    check(plan && ['promote', 'rollback'].includes(plan.action))
    check(hash(plan.evidenceSha256) && uint(plan.expectedPointerVersion))
    check(/^[0-9a-f]{40}$/.test(plan.releaseSha) && hash(plan.artifactSha256))
    check(instant(now) && Number.isSafeInteger(maxAgeMs) && maxAgeMs > 0 && maxAgeMs <= 86400000)
    check(Number.isSafeInteger(minSoakMs) && minSoakMs > 0 && minSoakMs <= 86400000)
    check(Number.isSafeInteger(partitionCount) && partitionCount > 0 && partitionCount <= 128)
    check(typeof previousBuildId === 'string' && previousBuildId !== plan.buildId)
    check(`sha256:${createHash('sha256').update(raw, 'utf8').digest('hex')}` === plan.evidenceSha256)
    const receipt = JSON.parse(raw)
    check(receipt?.apiVersion === 'event-platform.leaddrive.io/v1' && receipt.kind === 'OperatorRecoveryEvidence')
    for (const key of ['organizationId', 'buildId', 'projectionName', 'releaseSha', 'artifactSha256',
      'environment', 'clusterId', 'topicId', 'groupId', 'action', 'expectedPointerVersion']) {
      check(typeof plan[key] === 'string' && receipt[key] === plan[key])
    }
    check(receipt.previousBuildId === previousBuildId && id(receipt.receiptId))
    check(instant(receipt.observedAt) && instant(receipt.soakStartedAt))
    const observed = Date.parse(receipt.observedAt), clock = Date.parse(now), soak = Date.parse(receipt.soakStartedAt)
    check(clock - maxAgeMs <= observed && observed <= clock && soak <= observed - minSoakMs)
    check(receipt.targetEffectsFenced === true && receipt.externalEffectAttempts === '0' && receipt.unresolvedQuarantine === '0')
    check(receipt.stop?.intakeStopped === true && receipt.stop.acksFenced === true &&
      receipt.stop.sqlSettled === true && receipt.stop.childClosed === true && receipt.stop.actualCloseReceiptId && id(receipt.stop.actualCloseReceiptId))
    check(receipt.sourceHistoryComplete === true && receipt.archiveVerified === true)
    check(id(receipt.restoreReceiptId) && id(receipt.independentApprovalReceiptId))
    check(Array.isArray(receipt.partitions) && receipt.partitions.length === partitionCount)
    const partitions = new Set()
    for (const p of receipt.partitions) {
      check(Number.isInteger(p.partition) && p.partition >= 0 && p.partition < partitionCount && !partitions.has(p.partition))
      partitions.add(p.partition)
      for (const key of ['historyStart', 'replayStart', 'frozenEndExclusive', 'checkpointNext', 'archiveNext']) check(uint(p[key]))
      check(p.historyStart === p.replayStart && BigInt(p.historyStart) <= BigInt(p.frozenEndExclusive))
      check(p.checkpointNext === p.frozenEndExclusive && p.archiveNext === p.frozenEndExclusive)
    }
    // Compare every aggregate, not just totals: offsetting reducer errors fail.
    check(Array.isArray(receipt.source) && Array.isArray(receipt.shadow) && receipt.source.length > 0 &&
      receipt.source.length <= 10000 && receipt.source.length === receipt.shadow.length)
    const states = values => {
      const map = new Map()
      for (const state of values) {
        check(id(state.aggregateId) && !map.has(state.aggregateId) && uint(state.eventCount) && BigInt(state.eventCount) > 0n)
        check(uint(state.aggregateVersion) && state.aggregateVersion === state.eventCount)
        check(hash(state.historyHash) && hash(state.stateHash) && decimal(state.balance) && /^[A-Z]{3}$/.test(state.currency))
        map.set(state.aggregateId, state)
      }
      return map
    }
    const source = states(receipt.source), shadow = states(receipt.shadow)
    for (const [aggregateId, value] of source) {
      const target = shadow.get(aggregateId)
      check(target)
      for (const key of ['eventCount', 'aggregateVersion', 'historyHash', 'stateHash', 'balance', 'currency']) check(value[key] === target[key])
    }
    if (plan.action === 'rollback') {
      check(receipt.rollback?.retainedBuildId === plan.buildId && receipt.rollback.compatibilityVerified === true)
      check(instant(receipt.rollback.windowEndsAt) && Date.parse(receipt.rollback.windowEndsAt) > clock)
      check(receipt.rollback.writeFenceApplied === true)
    }
    return Object.freeze({ verified: true, action: plan.action, evidenceSha256: plan.evidenceSha256,
      receiptId: receipt.receiptId, aggregateCount: source.size, partitionCount })
  } catch { fail() }
}
