"use client"

import * as React from "react"

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = "", label, children, id, ...props }, ref) => {
    const generatedId = React.useId()
    const selectId = id ?? (label ? generatedId : undefined)

    return (
      <div className="space-y-1">
        {label && (
          <label htmlFor={selectId} className="text-sm font-medium">
            {label}
          </label>
        )}
        <select
          id={selectId}
          ref={ref}
          className={`flex h-10 w-full rounded-lg border border-zinc-200/70 dark:border-zinc-700/70 bg-card px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary/40 ${className}`}
          {...props}
        >
          {children}
        </select>
      </div>
    )
  }
)
Select.displayName = "Select"
