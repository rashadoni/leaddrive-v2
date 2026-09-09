import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { DEFAULT_CURRENCY, getCurrencySymbol } from "@/lib/currency"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format currency with full Intl formatting (e.g. "$1,234.56")
 */
export function formatCurrency(amount: number, currency = DEFAULT_CURRENCY): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(amount)
  } catch {
    // Fallback for unknown currency codes
    return `${getCurrencySymbol(currency)}${amount.toLocaleString()}`
  }
}

/**
 * Compact currency format: "$1.2M", "$450K", "$1,234"
 */
export function fmtCurrencyCompact(amount: number, currency = DEFAULT_CURRENCY): string {
  const sym = getCurrencySymbol(currency)
  if (Math.abs(amount) >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M ${sym}`
  if (Math.abs(amount) >= 1_000) return `${(amount / 1_000).toFixed(0)}K ${sym}`
  return `${amount.toLocaleString()} ${sym}`
}

/**
 * Simple currency format: "1,234.00 $" (number + symbol)
 */
export function fmtAmount(amount: number, currency = DEFAULT_CURRENCY): string {
  const sym = getCurrencySymbol(currency)
  return `${Math.round(amount).toLocaleString()} ${sym}`
}

/**
 * Currency format with decimals: "1,234.56 $"
 */
export function fmtAmountDecimal(amount: number, currency = DEFAULT_CURRENCY): string {
  const sym = getCurrencySymbol(currency)
  return `${amount.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${sym}`
}

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(date))
}
