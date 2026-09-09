/**
 * Jira-style taskKey generator — "<PREFIX>-<N>" (e.g. "KHS-55").
 *
 * N is the next integer for a Division's `key` prefix.
 *
 * CRITICAL (spec): the MAX is computed over ALL rows INCLUDING soft-deleted
 * ones. This is raw SQL on purpose — it deliberately bypasses the
 * `deletedAt IS NULL` Prisma client extension, because the
 * (organizationId, taskKey) unique index also constrains soft-deleted rows.
 * Reusing a soft-deleted task's number would hit a duplicate-key error.
 *
 * Concurrency: two callers racing can read the same MAX and compute the same
 * N. The unique index guarantees only one INSERT wins; the CALLER (POST /tasks)
 * MUST catch the Prisma P2002 unique violation and retry with a freshly
 * generated key. This generator is a single read — it does not retry.
 */

/** Minimal client surface — satisfied by PrismaClient and by test mocks. */
export interface TaskKeyClient {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>
}

/** Division.key must be a short uppercase alphanumeric token (regex-safe). */
const PREFIX_RE = /^[A-Z0-9]{1,16}$/

export function isValidDivisionKey(prefix: string): boolean {
  return PREFIX_RE.test(prefix)
}

export async function generateTaskKey(
  client: TaskKeyClient,
  organizationId: string,
  prefix: string,
): Promise<string> {
  if (!isValidDivisionKey(prefix)) {
    throw new Error(`Invalid division key "${prefix}" — expected /^[A-Z0-9]{1,16}$/`)
  }

  // Anchored capture pattern; `prefix` is validated above so it carries no
  // regex metacharacters. Used both as the `~` filter (index-friendly) and as
  // the capture for the numeric suffix. NO deletedAt filter — by design.
  const pattern = `^${prefix}-([0-9]+)$`

  const rows = await client.$queryRaw<Array<{ max: number | bigint | null }>>`
    SELECT MAX(CAST((regexp_match("taskKey", ${pattern}))[1] AS INTEGER)) AS max
    FROM "tasks"
    WHERE "organizationId" = ${organizationId} AND "taskKey" ~ ${pattern}
  `

  const max = Number(rows?.[0]?.max ?? 0)
  return `${prefix}-${max + 1}`
}
