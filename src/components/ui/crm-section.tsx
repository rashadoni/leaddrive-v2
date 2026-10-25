import type { ComponentPropsWithoutRef, ReactNode } from "react"
import { cn } from "@/lib/utils"

const sectionTones = {
  neutral: "",
  info: "border-l-4 border-l-sky-600 dark:border-l-sky-400",
  success: "border-l-4 border-l-emerald-600 dark:border-l-emerald-400",
  warning: "border-l-4 border-l-amber-600 dark:border-l-amber-400",
  destructive: "border-l-4 border-l-red-600 dark:border-l-red-400",
}

interface CrmSectionProps extends Omit<ComponentPropsWithoutRef<"section">, "title"> {
  title?: ReactNode
  icon?: ReactNode
  /** Use an accent only when the section has a meaningful status. */
  tone?: keyof typeof sectionTones
}

/** Shared group for record details, forms and activity panels. */
export function CrmSection({ title, icon, tone = "neutral", className, children, ...props }: CrmSectionProps) {
  return (
    <section
      data-crm-section=""
      className={cn("min-w-0 rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm sm:p-5", sectionTones[tone], className)}
      {...props}
    >
      {title && <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold">{icon && <span aria-hidden="true" className="shrink-0 text-muted-foreground [&_svg]:size-4">{icon}</span>}{title}</h3>}
      {children}
    </section>
  )
}
