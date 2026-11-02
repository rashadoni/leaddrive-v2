import { cn } from "@/lib/utils"

/**
 * A client's class (A, B, C, D, VIP) in a column of its own — on «Müştərilər»
 * and in the list of doctors to give an agent (owner, 2026-10-21: «это должно
 * указываться как дополнительный столбец»). Outlined, as the calm colours ask;
 * VIP in violet, as on the phone.
 */
export function MtmContactClassTag({ category, testId }: { category: string | null; testId?: string }) {
  if (!category) return <span className="text-muted-foreground" data-testid={testId}>—</span>
  return (
    <span
      data-testid={testId}
      className={cn(
        "inline-flex min-w-8 justify-center rounded-full border px-2 py-0.5 text-xs font-semibold",
        category === "VIP"
          ? "border-violet-300 text-violet-700 dark:border-violet-700 dark:text-violet-300"
          : "border-zinc-300 text-foreground dark:border-zinc-600",
      )}
    >
      {category}
    </span>
  )
}
