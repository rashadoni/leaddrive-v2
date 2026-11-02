/** Inactive A5 building block. No sender, activation or credential fallback.
 * readReceipt must be a trusted, read-only provider/archive adapter owned by
 * the controller, never a callback/URL supplied by an operator request.
 * Passing fixtures proves validation only, never actual delivery.
 */
export const OPERATOR_ALERT_GATES = Object.freeze([
  'connectorFailure', 'outboxAge', 'slotWalBytes', 'postgresFreeSpace',
  'underReplicatedPartitions', 'consumerLag', 'schemaRejections',
  'quarantineRate', 'archiveLag', 'tenantProjectionParity',
])
const fail = () => { throw new Error('OPERATOR_ALERT_EVIDENCE_INVALID') }
const check = value => { if (!value) fail() }
const token = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)
const instant = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value

export async function verifyOperatorAlertEvidence(evidence, expected, readReceipt) {
  try {
    // Keep independent authority stable across every asynchronous read-back.
    expected = structuredClone(expected)
    check(typeof readReceipt === 'function')
    check(expected && /^[a-z][a-z0-9]{0,31}$/.test(expected.environment))
    check(/^[0-9a-f]{40}$/.test(expected.releaseSha))
    for (const key of ['changeId', 'challengeId', 'destinationId', 'responderId']) check(token(expected[key]))
    check(instant(expected.now))
    check(Number.isSafeInteger(expected.maxAgeMs) && expected.maxAgeMs > 0 && expected.maxAgeMs <= 86400000)
    check(evidence?.kind === 'KafkaOperatorAlertEvidence' && evidence.apiVersion === 'event-platform.leaddrive.io/v1')
    for (const key of ['environment', 'releaseSha', 'changeId', 'challengeId']) check(evidence[key] === expected[key])
    check(Array.isArray(evidence.receipts) && evidence.receipts.length === OPERATOR_ALERT_GATES.length)
    const gates = new Set(), ids = new Set()
    // Validate the complete manifest before any read-back.
    const manifest = evidence.receipts.map(item => {
      check(item && OPERATOR_ALERT_GATES.includes(item.gate) && !gates.has(item.gate))
      check(token(item.receiptId) && !ids.has(item.receiptId))
      gates.add(item.gate); ids.add(item.receiptId)
      return { gate: item.gate, receiptId: item.receiptId }
    })
    for (const item of manifest) {
      const receipt = await readReceipt(item.receiptId)
      check(receipt?.receiptId === item.receiptId && receipt.gate === item.gate)
      for (const key of ['environment', 'releaseSha', 'changeId', 'challengeId', 'destinationId', 'responderId']) check(receipt[key] === expected[key])
      check(receipt.status === 'delivered' && receipt.acknowledged === true)
      check(instant(receipt.triggeredAt) && instant(receipt.deliveredAt) && instant(receipt.acknowledgedAt))
      const trigger = Date.parse(receipt.triggeredAt), delivered = Date.parse(receipt.deliveredAt)
      const ack = Date.parse(receipt.acknowledgedAt), now = Date.parse(expected.now)
      check(now - expected.maxAgeMs <= trigger && trigger <= delivered && delivered <= ack && ack <= now)
    }
    return Object.freeze({ verified: true, gateCount: manifest.length, changeId: expected.changeId })
  } catch {
    // Never expose provider errors, destinations, response bodies or secrets.
    fail()
  }
}
