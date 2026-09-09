"use client"

import React, { ReactNode } from "react"
import { useTranslations } from "next-intl"
import { AlertCircle } from "lucide-react"

interface Props {
  children: ReactNode
  module: string
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

function ErrorFallback({ module }: { module: string }) {
  const t = useTranslations("common")
  return (
    <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">
      <AlertCircle className="h-5 w-5 flex-shrink-0" />
      <div>
        <p className="font-medium">{t("moduleUnavailable", { module })}</p>
        <p className="text-sm">{t("tryAgainLater")}</p>
      </div>
    </div>
  )
}

export class ModuleErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error(`Module error (${this.props.module}):`, error, errorInfo)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return this.props.fallback ?? <ErrorFallback module={this.props.module} />
    }

    return this.props.children
  }
}
