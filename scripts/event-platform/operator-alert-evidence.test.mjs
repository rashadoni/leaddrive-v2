import test from 'node:test'
import assert from 'node:assert/strict'
import { OPERATOR_ALERT_GATES, verifyOperatorAlertEvidence } from './operator-alert-evidence.mjs'
function fixture() {
  const expected = { environment: 'staging', releaseSha: 'a'.repeat(40), changeId: 'change-1', challengeId: 'challenge-1', destinationId: 'oncall-1', responderId: 'operator-2', now: '2026-10-19T00:00:00.000Z', maxAgeMs: 60000 }
  const evidence = { apiVersion: 'event-platform.leaddrive.io/v1', kind: 'KafkaOperatorAlertEvidence', ...expected,
    receipts: OPERATOR_ALERT_GATES.map((gate, i) => ({ gate, receiptId: `receipt-${i}` })) }
  const receipts = evidence.receipts.map(item => ({ ...expected, ...item, status: 'delivered', acknowledged: true,
    triggeredAt: '2026-10-18T23:59:10.000Z', deliveredAt: '2026-10-18T23:59:20.000Z', acknowledgedAt: '2026-10-18T23:59:30.000Z' }))
  return { expected, evidence, receipts, read: async id => receipts.find(r => r.receiptId === id) }
}
const rejected = f => assert.rejects(verifyOperatorAlertEvidence(f.evidence, f.expected, f.read), { message: 'OPERATOR_ALERT_EVIDENCE_INVALID' })
test('all ten independently read receipts verify; no activation authority returned', async () => {
  const f = fixture()
  assert.deepEqual(await verifyOperatorAlertEvidence(f.evidence, f.expected, f.read), { verified: true, gateCount: 10, changeId: 'change-1' })
})
for (const field of ['environment', 'releaseSha', 'changeId', 'challengeId', 'destinationId', 'responderId', 'receiptId', 'gate']) {
  test(`reject read-back ${field} mismatch`, async () => { const f = fixture(); f.receipts[0][field] = 'wrong'; await rejected(f) })
}
for (const [field, value] of [['status', 'accepted'], ['acknowledged', false], ['triggeredAt', '2026-10-18T23:58:00.000Z'], ['deliveredAt', '2026-10-19T00:01:00.000Z'], ['acknowledgedAt', '2026-10-18T23:59:00.000Z'], ['triggeredAt', '2026-02-30T00:00:00.000Z']]) {
  test(`reject invalid delivery ${field}=${value}`, async () => { const f = fixture(); f.receipts[0][field] = value; await rejected(f) })
}
test('reject missing receipt read-back', async () => { const f = fixture(); f.read = async () => undefined; await rejected(f) })
test('sanitize provider error', async () => { const f = fixture(); f.read = async () => { throw new Error('secret') }; await rejected(f) })
for (const mutation of [f => f.evidence.receipts.pop(), f => f.evidence.receipts[1] = f.evidence.receipts[0], f => f.evidence.receipts[0].receiptId = '../url', f => f.evidence.releaseSha = 'b'.repeat(40), f => f.expected.maxAgeMs = Infinity, f => f.expected.now = 'invalid', f => f.expected.maxAgeMs = 86400001]) {
  test('reject invalid manifest/policy before read-back', async () => {
    const f = fixture(); mutation(f); let reads = 0; f.read = async () => { reads++; return {} }
    await rejected(f); assert.equal(reads, 0)
  })
}
test('reject same receipt ID reused for distinct gates before any read', async () => {
  const f = fixture(); f.evidence.receipts[1].receiptId = f.evidence.receipts[0].receiptId
  let reads = 0; f.read = async () => { reads++; return {} }
  await rejected(f); assert.equal(reads, 0)
})
test('reject evidence-only boolean delivery assertions', async () => {
  const f = fixture(); f.evidence.monitoring = Object.fromEntries(OPERATOR_ALERT_GATES.map(gate => [gate, true]))
  f.read = async () => ({ status: 'delivered', acknowledged: true })
  await rejected(f)
})
test('accept exact freshness/ordering boundary with independent read-back', async () => {
  const f = fixture()
  for (const receipt of f.receipts) {
    receipt.triggeredAt = '2026-10-18T23:59:00.000Z'
    receipt.deliveredAt = receipt.acknowledgedAt = f.expected.now
  }
  assert.equal((await verifyOperatorAlertEvidence(f.evidence, f.expected, f.read)).verified, true)
})
test('require every gate read-back, including final tenant parity receipt', async () => {
  const f = fixture(); f.receipts.at(-1).acknowledged = false
  await rejected(f)
})
