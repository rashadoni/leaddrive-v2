import { createHash } from "node:crypto"

/** Hash a lease capability before it enters the append-only event ledger. */
export function hashAiVoiceActionExecutionLeaseToken(token: string): string {
  return createHash("sha256")
    .update("leaddrive:ai-action-execution-lease:v1\n", "utf8")
    .update(token, "utf8")
    .digest("hex")
}
