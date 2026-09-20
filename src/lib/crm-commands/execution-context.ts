import type { Prisma } from "@prisma/client"

export type CrmCommandPostCommitEffect = () => void | Promise<void>

/**
 * Internal execution boundary for adapters that must include a canonical CRM
 * mutation in a wider transaction. Callers providing a transaction must also
 * provide an effect collector so notifications, webhooks and workflows cannot
 * escape before that wider transaction commits.
 */
export type CrmCommandExecutionContext = Readonly<{
  transaction?: Prisma.TransactionClient
  postCommitEffects?: CrmCommandPostCommitEffect[]
}>

export function dispatchOrDeferCommandEffects(
  context: CrmCommandExecutionContext | undefined,
  effect: CrmCommandPostCommitEffect,
): void {
  if (!context?.transaction) {
    try {
      void Promise.resolve(effect()).catch((error) => {
        console.error("[crm-command] post-commit effect failed", error)
      })
    } catch (error) {
      console.error("[crm-command] post-commit effect failed", error)
    }
    return
  }
  if (!context.postCommitEffects) {
    throw new TypeError("Transactional CRM commands require a post-commit effect collector")
  }
  context.postCommitEffects.push(effect)
}

export function dispatchCollectedCommandEffects(
  effects: readonly CrmCommandPostCommitEffect[],
): void {
  for (const effect of effects) {
    try {
      void Promise.resolve(effect()).catch((error) => {
        console.error("[crm-command] deferred post-commit effect failed", error)
      })
    } catch (error) {
      console.error("[crm-command] deferred post-commit effect failed", error)
    }
  }
}
