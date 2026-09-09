"use client"

export function TryAgainButton() {
  return (
    <button
      onClick={() => window.location.reload()}
      className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-6 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      Try again
    </button>
  )
}
