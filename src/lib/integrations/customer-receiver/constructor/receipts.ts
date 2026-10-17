import { identifier, record, utcTime, uuid, type AcceptanceReceipt } from "../contract"
import { safePath, type BuilderProfile } from "./profile"
import { BuilderEvaluationError } from "./engine"

function readPath(input: unknown, path: string): unknown {
  if (!safePath(path)) throw new BuilderEvaluationError("unsafe_receipt_path")
  let current = input
  for (const key of path.split(".")) {
    const object = record(current)
    if (!Object.hasOwn(object, key)) throw new BuilderEvaluationError("missing_receipt_field")
    current = object[key]
  }
  return current
}

/** Normalize the agreed response aliases; never infer ERP completion from HTTP. */
export function parseMappedAcceptance(input: {
  receipt: BuilderProfile["receipt"]
  expected: { eventId: string; externalId: string; entityVersion: number }
  body: unknown
}): AcceptanceReceipt {
  const { receipt, expected } = input
  const body = record(input.body)
  if (body.error !== undefined && body.error !== null && body.error !== false && body.error !== "") throw new BuilderEvaluationError("receiver_reported_error")
  if (readPath(body, receipt.statusPath) !== receipt.acceptedValue) throw new BuilderEvaluationError("not_accepted")
  const eventId = uuid(readPath(body, receipt.eventIdPath))
  const externalId = identifier(readPath(body, receipt.externalIdPath))
  const acceptedVersion = readPath(body, receipt.versionPath)
  if (eventId !== expected.eventId || externalId !== expected.externalId || acceptedVersion !== expected.entityVersion) throw new BuilderEvaluationError("receipt_identity_mismatch")
  return {
    operationId: identifier(readPath(body, receipt.operationIdPath)),
    eventId, externalId, receiptId: identifier(readPath(body, receipt.receiptIdPath)),
    status: "accepted", acceptedVersion: expected.entityVersion,
    acceptedAt: utcTime(readPath(body, receipt.acceptedAtPath)),
  }
}
