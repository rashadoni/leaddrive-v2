type FileSizeUnit = "byte" | "kilobyte" | "megabyte"

export function formatFileSize(bytes: number, locale: string): string {
  const safeBytes = Number.isFinite(bytes) && bytes > 0 ? bytes : 0
  let unit: FileSizeUnit = "byte"
  let value = safeBytes

  if (safeBytes >= 1024 * 1024) {
    unit = "megabyte"
    value = safeBytes / (1024 * 1024)
  } else if (safeBytes >= 1024) {
    unit = "kilobyte"
    value = safeBytes / 1024
  }

  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit,
    unitDisplay: "short",
    maximumFractionDigits: unit === "byte" ? 0 : 1,
  }).format(value)
}
