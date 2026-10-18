import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { validateOperatorRecoveryEvidence } from './operator-recovery-evidence.mjs'
function fixture(action = 'promote') {
  const plan = { organizationId: 'org-a', buildId: 'new-build', projectionName: 'finance.fund-balance', releaseSha: 'a'.repeat(40),
    artifactSha256: `sha256:${'b'.repeat(64)}`, environment: 'staging', clusterId: 'cluster-a', topicId: 'topic-a',
    groupId: 'group-a', action, expectedPointerVersion: '2' }
  const state = { aggregateId: 'fund-a', eventCount: '3', aggregateVersion: '3', historyHash: `sha256:${'c'.repeat(64)}`,
    stateHash: `sha256:${'d'.repeat(64)}`, balance: '10.0000', currency: 'AZN' }
  const receipt = { apiVersion: 'event-platform.leaddrive.io/v1', kind: 'OperatorRecoveryEvidence', ...plan,
    previousBuildId: 'old-build', receiptId: 'receipt-1', observedAt: '2026-10-19T00:00:00.000Z', soakStartedAt: '2026-10-18T23:59:00.000Z',
    targetEffectsFenced: true, externalEffectAttempts: '0', unresolvedQuarantine: '0',
    stop: { intakeStopped: true, acksFenced: true, sqlSettled: true, childClosed: true, actualCloseReceiptId: 'close-1' },
    sourceHistoryComplete: true, archiveVerified: true, restoreReceiptId: 'restore-1', independentApprovalReceiptId: 'approval-1',
    partitions: [{ partition: 0, historyStart: '0', replayStart: '0', frozenEndExclusive: '5', checkpointNext: '5', archiveNext: '5' }],
    source: [state, { ...state, aggregateId: 'fund-b', balance: '20.0000' }],
    shadow: [structuredClone(state), { ...state, aggregateId: 'fund-b', balance: '20.0000' }],
    rollback: { retainedBuildId: plan.buildId, compatibilityVerified: true, windowEndsAt: '2026-10-19T01:00:00.000Z', writeFenceApplied: true } }
  const expected = { plan, now: '2026-10-19T00:00:10.000Z', maxAgeMs: 30000, minSoakMs: 60000, partitionCount: 1, previousBuildId: 'old-build' }
  const pin = () => { const raw = JSON.stringify(receipt); plan.evidenceSha256 = `sha256:${createHash('sha256').update(raw).digest('hex')}`; return raw }
  return { receipt, expected, pin }
}
for (const action of ['promote', 'rollback']) test(`accept complete isolated ${action} receipt`, () => {
  const f = fixture(action); assert.equal(validateOperatorRecoveryEvidence(f.pin(), f.expected).verified, true)
})
const cases = {
  'cross tenant': f => f.receipt.organizationId = 'org-b',
  'wrong build': f => f.receipt.buildId = 'other',
  'wrong code': f => f.receipt.releaseSha = 'c'.repeat(40),
  'wrong topic incarnation': f => f.receipt.topicId = 'topic-b',
  'stale pointer': f => f.receipt.expectedPointerVersion = '1',
  'incomplete history': f => f.receipt.sourceHistoryComplete = false,
  'retention gap': f => f.receipt.partitions[0].replayStart = '1',
  'not caught up': f => f.receipt.partitions[0].checkpointNext = '4',
  'archive lag': f => f.receipt.partitions[0].archiveNext = '4',
  'unsafe offset': f => f.receipt.partitions[0].checkpointNext = 5,
  'missing partition': f => f.expected.partitionCount = 2,
  'duplicate partition': f => { f.expected.partitionCount = 2; f.receipt.partitions.push(f.receipt.partitions[0]) },
  'unsettled SQL': f => f.receipt.stop.sqlSettled = false,
  'unclosed child': f => f.receipt.stop.childClosed = false,
  'unfenced ACK': f => f.receipt.stop.acksFenced = false,
  'effect attempt': f => f.receipt.externalEffectAttempts = '1',
  'unfenced build': f => f.receipt.targetEffectsFenced = false,
  'quarantine': f => f.receipt.unresolvedQuarantine = '1',
  'stale observation': f => f.receipt.observedAt = '2026-10-18T23:58:00.000Z',
  'future observation': f => f.receipt.observedAt = '2026-10-19T00:01:00.000Z',
  'short soak': f => f.receipt.soakStartedAt = f.receipt.observedAt,
  'missing restore': f => delete f.receipt.restoreReceiptId,
  'unknown hash': f => f.receipt.shadow[0].stateHash = `sha256:${'f'.repeat(64)}`,
  'missing aggregate': f => f.receipt.shadow.pop(),
  'duplicate aggregate': f => f.receipt.shadow[1] = f.receipt.shadow[0],
  'wrong currency': f => f.receipt.shadow[0].currency = 'USD',
  'sequence gap': f => f.receipt.source[0].eventCount = '2',
  'float balance': f => f.receipt.shadow[0].balance = 10,
  'offsetting wrong reducer balances': f => { f.receipt.shadow[0].balance = '11.0000'; f.receipt.shadow[1].balance = '19.0000' },
}
for (const [name, change] of Object.entries(cases)) test(`reject ${name}`, () => {
  const f = fixture(); change(f)
  assert.throws(() => validateOperatorRecoveryEvidence(f.pin(), f.expected), { message: 'OPERATOR_RECOVERY_EVIDENCE_INVALID' })
})
for (const change of [f => f.receipt.rollback.compatibilityVerified = false, f => f.receipt.rollback.writeFenceApplied = false,
  f => f.receipt.rollback.retainedBuildId = 'other', f => f.receipt.rollback.windowEndsAt = '2026-10-19T00:00:01.000Z']) {
  test('reject unsafe rollback', () => { const f = fixture('rollback'); change(f); assert.throws(() => validateOperatorRecoveryEvidence(f.pin(), f.expected)) })
}
test('exact receipt bytes pinned; tampering cannot be normalized away', () => {
  const f = fixture(); const raw = f.pin()
  assert.throws(() => validateOperatorRecoveryEvidence(`${raw}\n`, f.expected))
  assert.throws(() => validateOperatorRecoveryEvidence('{', f.expected))
})
