export const CONTACT_LIFECYCLE_STAGES = [
  "lead",
  "engaged",
  "mql",
  "sql",
  "opportunity",
  "customer",
  "churned",
] as const

export type ContactLifecycleStage = (typeof CONTACT_LIFECYCLE_STAGES)[number]

export function isContactLifecycleStage(value: string): value is ContactLifecycleStage {
  return (CONTACT_LIFECYCLE_STAGES as readonly string[]).includes(value)
}
