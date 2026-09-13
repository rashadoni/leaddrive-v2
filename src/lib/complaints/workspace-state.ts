type SearchParamsLike = { toString(): string }

export function complaintRegistryPath(searchParams: SearchParamsLike): string {
  const query = searchParams.toString()
  return query ? `/complaints?${query}` : "/complaints"
}

export function safeComplaintReturnTo(value: string | null | undefined): string {
  if (!value) return "/complaints"
  if (!value.startsWith("/complaints") || value.startsWith("//")) return "/complaints"
  if (value.startsWith("/complaints/new") || value.startsWith("/complaints/import")) return "/complaints"
  if (/^\/complaints\/[^?]+/.test(value)) return "/complaints"
  return value
}

export function complaintChildHref(path: string, returnTo: string): string {
  const separator = path.includes("?") ? "&" : "?"
  return `${path}${separator}returnTo=${encodeURIComponent(safeComplaintReturnTo(returnTo))}`
}

export function complaintScrollStorageKey(returnTo: string): string {
  return `complaints:scroll:${safeComplaintReturnTo(returnTo)}`
}
