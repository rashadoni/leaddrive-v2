/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Prisma client with multi-tenant extensions.
 *
 * NOTE: PrismaClient will be available after `npx prisma generate` is run
 * (requires network for engine download). Until then, this exports a placeholder.
 * Run `npx prisma generate` after Docker setup (Task 0.16).
 */

import { getRlsContext, rlsStorage, runWithTenant, type RlsContext } from "./rls-context"

let PrismaClientClass: any

try {
  PrismaClientClass = require("@prisma/client").PrismaClient
} catch {
  // PrismaClient not generated yet — provide stub for build
  PrismaClientClass = class StubPrismaClient {
    $extends() { return this }
  }
}
const globalForPrisma = globalThis as unknown as { prisma: InstanceType<typeof PrismaClientClass> }

const basePrisma = globalForPrisma.prisma ?? new PrismaClientClass()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = basePrisma

/**
 * Soft-delete where-helper. Adds `deletedAt: null` unless the caller already
 * referenced deletedAt (escape hatch for include-deleted / restore flows).
 * Exported for unit testing the invariant.
 */
export function notDeletedWhere(where: any) {
  const w = where ?? {}
  return "deletedAt" in w ? w : { ...w, deletedAt: null }
}

/**
 * Soft-delete extension for `task`: every READ excludes deletedAt rows. Covers
 * findMany / findFirst / findFirstOrThrow / count / aggregate / groupBy via
 * where-injection, plus findUnique / findUniqueOrThrow via a result guard.
 * Writes (update/delete) are intentionally NOT filtered — callers do a filtered
 * findFirst (→ 404) first. Raw queries ($queryRaw) bypass extensions entirely,
 * which is exactly how the taskKey generator counts soft-deleted rows.
 */
const prismaExtended = basePrisma.$extends({
  query: {
    task: {
      async findMany({ args, query }: any) { args.where = notDeletedWhere(args.where); return query(args) },
      async findFirst({ args, query }: any) { args.where = notDeletedWhere(args.where); return query(args) },
      async findFirstOrThrow({ args, query }: any) { args.where = notDeletedWhere(args.where); return query(args) },
      async count({ args, query }: any) { args.where = notDeletedWhere(args.where); return query(args) },
      async aggregate({ args, query }: any) { args.where = notDeletedWhere(args.where); return query(args) },
      async groupBy({ args, query }: any) { args.where = notDeletedWhere(args.where); return query(args) },
      async findUnique({ args, query }: any) {
        const r: any = await query(args)
        return r && r.deletedAt != null ? null : r
      },
      async findUniqueOrThrow({ args, query }: any) {
        const r: any = await query(args)
        if (r && r.deletedAt != null) throw new Error("Task not found")
        return r
      },
    },
  },
})

/* ------------------------------------------------------------------ */
/* Postgres RLS context injection                                      */
/* ------------------------------------------------------------------ */

/** Builds the transaction-local set_config statement on the given client (basePrisma or an interactive tx). */
function setCfgOn(client: any, ctx: RlsContext) {
  return ctx.bypass
    ? client.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`
    : client.$executeRaw`SELECT set_config('app.org_id', ${ctx.orgId}, true)`
}

/**
 * Per-operation wrap (exported for unit tests). With tenant/bypass context the
 * operation is batched into a transaction with set_config so both share one
 * connection (documented Prisma RLS pattern). No context → pass through (the
 * DB fails closed once RLS is enabled). inTx → set_config already ran at tx
 * open. setCfg is built on basePrisma so this hook can't recurse on $executeRaw.
 */
/**
 * Org-scoped model names (PascalCase) — models carrying an `organizationId` field,
 * i.e. the tables RLS policies apply to. Built from the Prisma DMMF at module load
 * so it can never drift from the schema.
 */
const ORG_SCOPED_MODELS: Set<string> = (() => {
  try {
    const { Prisma } = require("@prisma/client")
    return new Set<string>(
      (Prisma.dmmf?.datamodel?.models ?? [])
        .filter((m: any) => m.fields?.some((f: any) => f.name === "organizationId"))
        .map((m: any) => m.name),
    )
  } catch {
    return new Set<string>()
  }
})()

/** Dedup so each org-scoped model.operation gap logs ONCE per process, not per request. */
const rlsGuardSeen = new Set<string>()

/**
 * Phase 3 guardrail. In the TEST env only, a definitely-org-scoped model op that
 * runs with NO RLS context THROWS (fails the test / CI) instead of only warning.
 * Rationale: such a query fail-closes under RLS in prod (empty reads / WITH CHECK
 * reject). The static gap-finder (scripts/rls/find-context-gaps.py) catches the
 * route + lib-delegation layers, but has documented blind spots (class-method
 * helpers, `tx.<model>` in interactive txns, dynamic dispatch); this runtime
 * assertion is the backstop that turns those into a CI failure, not a prod incident.
 *
 * Scoped to org-scoped MODEL ops only — raw $queryRaw/$executeRaw stay warn-only
 * because the guard can't prove which table a raw statement hits (health checks and
 * other legit context-less raw queries must not fail CI). Never throws in dev/prod
 * (observe-only warn there — safe). RLS_TEST_DATABASE_URL opts out so the real-DB
 * fail-closed repro (rls-modelop-repro.test.ts) can still probe the no-context path
 * against Postgres and assert the 0-row behavior.
 */
const RLS_GUARD_THROW =
  (process.env.NODE_ENV === "test" || !!process.env.VITEST) && !process.env.RLS_TEST_DATABASE_URL

export function __rlsPerOpWrap(txOpener: any) {
  return async function rlsAllOperations({ args, query, operation, model }: any) {
    const ctx = getRlsContext()
    if (!ctx || ctx.inTx) {
      // RLS GUARD (defense-in-depth, ALL envs): an org-scoped query with NO RLS
      // context fail-closes once RLS is on (empty reads / WITH CHECK violation) — or
      // silently returns wrong data if a caller has a no-context fallback (e.g.
      // cost-model loadAndCompute). The static route/gate scans are blind to queries
      // delegated THROUGH helpers, so this runtime guard is the only thing that
      // catches every depth. Logs the call path once per model.operation so the gap
      // can be traced and wrapped. In dev/prod it observe-only warns (safe); in the
      // test env it THROWS for org-scoped model ops (Phase 3 CI guardrail below).
      if (!ctx) {
        // model op on an org-scoped table, OR a raw query (model===undefined for
        // $queryRaw/$executeRaw — the guard can't see which table it hits, so flag
        // ALL no-context raw queries to verify tenant scope). Either is a candidate
        // fail-close / silent-empty under RLS.
        const orgModel = model && ORG_SCOPED_MODELS.has(model)
        const rawOp = !model && /^\$(?:queryRaw|executeRaw)/.test(operation || "")
        if (orgModel || rawOp) {
          const key = orgModel ? `${model}.${operation}` : `raw.${operation}`
          // Phase 3: an org-scoped model op with no context is a CI FAILURE in the
          // test env (RLS_GUARD_THROW). Otherwise warn once per key. Raw ops are
          // always warn-only — the guard can't prove the table is org-scoped.
          const willThrow = !!orgModel && RLS_GUARD_THROW
          if (willThrow || !rlsGuardSeen.has(key)) {
            const stack = (new Error().stack ?? "").split("\n").slice(2, 7).map((s) => s.trim()).join(" <- ")
            const what = orgModel
              ? `org-scoped ${key}`
              : `${key} (table unknown — if org-scoped it fail-closes under RLS)`
            const msg = `[RLS-GUARD] ${what} ran with NO RLS context — wrap the call path in runWithTenant/runWithRlsBypass. ${stack}`
            if (willThrow) throw new Error(msg)
            rlsGuardSeen.add(key)
            console.warn(msg)
          }
        }
      }
      return query(args)
    }
    const [, result] = await txOpener.$transaction([setCfgOn(txOpener, ctx), query(args)])
    return result
  }
}

const rlsExtended = prismaExtended.$extends({
  query: {
    // top-level $allOperations: covers ALL model ops AND $queryRaw/$executeRaw/$queryRawUnsafe/$executeRawUnsafe
    $allOperations: __rlsPerOpWrap(basePrisma),
  },
})

/**
 * $transaction override (exported for unit tests). $extends cannot shadow
 * built-ins, so the exported client is a Proxy that swaps $transaction:
 * - interactive form: the {inTx:true} scope is entered FIRST, then set_config
 *   runs as the first statement on the tx connection. Order matters: in
 *   Prisma 6 query extensions DO apply to the interactive tx client (verified
 *   against the scratch PG), so without inTx the per-op hook would hijack the
 *   tx.$executeRaw set_config into a side batch on basePrisma — i.e. onto the
 *   WRONG connection, leaving the tx unscoped (fail-closed empty reads);
 * - batch form: set_config is prepended on the same batch tx and sliced off
 *   the results. Per-item hooks execute inside the run({inTx:true}) scope
 *   (verified by scripts/rls/spike-extension-mechanics.mjs CHECK4).
 */
export function __wrapTransaction(base: any, setCfgClient: any) {
  return function $transaction(arg: any, opts?: any) {
    const ctx = getRlsContext()
    if (!ctx || ctx.inTx) return base.$transaction(arg, opts)
    if (typeof arg === "function") {
      return base.$transaction(async (tx: any) => {
        return rlsStorage.run({ ...ctx, inTx: true }, async () => {
          await setCfgOn(tx, ctx)
          return arg(tx)
        })
      }, opts)
    }
    return rlsStorage
      .run({ ...ctx, inTx: true }, () => base.$transaction([setCfgOn(setCfgClient, ctx), ...arg], opts))
      .then((results: any[]) => results.slice(1))
  }
}

/** Wrap a client in the $transaction-override Proxy; re-wraps $extends children so tenantPrisma stays covered. */
function withRlsTxOverride<T extends object>(client: T): T {
  return new Proxy(client, {
    get(target: any, prop) {
      if (prop === "$transaction") return __wrapTransaction(target, basePrisma)
      if (prop === "$extends") {
        const orig = target[prop]
        return (...a: any[]) => withRlsTxOverride(orig.apply(target, a))
      }
      const v = target[prop]
      return typeof v === "function" ? v.bind(target) : v
    },
  })
}

export const prisma = withRlsTxOverride(rlsExtended)

/**
 * Create a tenant-scoped prisma client.
 * All queries automatically filter by organizationId.
 * All creates automatically inject organizationId.
 */
export function tenantPrisma(organizationId: string) {
  // Chain from the RLS-extended client (which chains from soft-delete) so
  // tenant-scoped reads exclude deletedAt AND carry RLS set_config; the
  // Proxy re-wrap keeps the $transaction override on the derived client.
  return prisma.$extends({
    query: {
      $allModels: {
        async findMany({ args, query }: any) {
          args.where = { ...args.where, organizationId }
          return query(args)
        },
        async findFirst({ args, query }: any) {
          args.where = { ...args.where, organizationId }
          return query(args)
        },
        async findUnique({ args, query }: any) {
          const result = await query(args)
          // Verify tenant isolation: reject if result belongs to a different org
          if (result && "organizationId" in result && result.organizationId !== organizationId) {
            return null
          }
          return result
        },
        async create({ args, query }: any) {
          if (args.data && typeof args.data === "object" && !Array.isArray(args.data)) {
            args.data.organizationId = organizationId
          }
          return query(args)
        },
        async update({ args, query }: any) {
          args.where = { ...args.where, organizationId }
          return query(args)
        },
        async delete({ args, query }: any) {
          args.where = { ...args.where, organizationId }
          return query(args)
        },
        async count({ args, query }: any) {
          args.where = { ...args.where, organizationId }
          return query(args)
        },
      },
    },
  })
}

/** Persist an audit log entry; callers may await security-sensitive writes. */
export async function logAudit(
  orgId: string,
  action: string,
  entityType: string,
  entityId: string,
  entityName?: string,
  extra?: {
    oldValue?: any
    newValue?: any
    userId?: string
    ipAddress?: string
    userAgent?: string
  },
) {
  // Self-wrap in tenant context so the org-scoped auditLog INSERT commits under RLS
  // even when called from a context-less route (e.g. superadmin admin/plans). orgId is
  // always a real org id here. Security-sensitive callers await this promise;
  // legacy fire-and-forget callers remain compatible because async execution
  // begins immediately.
  try {
    await runWithTenant(orgId, () => prisma.auditLog.create({
      data: {
        organizationId: orgId,
        action,
        entityType,
        entityId,
        entityName: entityName || undefined,
        oldValue: extra?.oldValue || undefined,
        newValue: extra?.newValue || undefined,
        userId: extra?.userId || undefined,
        ipAddress: extra?.ipAddress || undefined,
        userAgent: extra?.userAgent || undefined,
      },
    }))
  } catch (error) {
    console.error("[audit] failed to persist audit log", {
      action,
      entityType,
      entityId,
      error,
    })
  }
}
