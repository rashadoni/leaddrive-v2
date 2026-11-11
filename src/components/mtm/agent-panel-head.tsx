import type { ReactNode } from "react"

/** The head of the picker card on the agent's page: what it is for, and the «by specialty / whole list» switch in its corner. */
export function MtmAgentPanelHead({ title, body, switcher }: { title: string; body: string; switcher?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h2 className="text-lg font-bold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      </div>
      {switcher ? <div className="shrink-0">{switcher}</div> : null}
    </div>
  )
}
