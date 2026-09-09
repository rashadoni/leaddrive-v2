// Pricing module constants and utilities
// Ported from v1 Python (export_excel.py + api.py)

export const GROUP_ORDER = ['Tabia', 'AFI', 'Azmade', 'PMD', 'Novex', 'Azersheker', 'Separated']

export const MONTHS_AZ = [
  'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun',
  'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr',
]

export const BOARD_CATS = [
  'Daimi İT xidməti', 'İnfosec', 'Əlavə IT xidməti',
  'SAAS xidməti', 'ERP', 'GRC', 'Layihə',
]

export const CATEGORY_MAP: Record<string, string[]> = {
  'Daimi İT xidməti': ['İT İnfrastruktur', 'Məlumat Bazası', 'Video, Monitorinq'],
  'İnfosec': ['İnformasiya Təhlükəsizlik', 'Təlim və Maarifləndirmə'],
  'Əlavə IT xidməti': ['HelpDesk və Texniki Dəstək'],
  'SAAS xidməti': ['Bulud Xidmətləri'],
  'ERP': ['Avtomatlaşdırılmış Sistemlər', 'SaaS Biznes Process'],
  'GRC': ['Audit və Uyğunluq'],
  'Layihə': ['Konsaltinq və Layihə'],
}

export const COLORS = {
  header_bg: 'FF1B2A4A',
  header_font: 'FFFFFFFF',
  group_bg: 'FF2D4A7A',
  group_font: 'FFFFFFFF',
  alt_row: 'FFF0F4FA',
  total_bg: 'FF1B2A4A',
  total_font: 'FFFFFFFF',
  border: 'FFB0BEC5',
  kpi_bg: 'FFE8F5E9',
  kpi_val: 'FF1B5E20',
  adj_green: 'FFE8F5E9',
  adj_font: 'FF1B5E20',
}

export interface PricingService {
  name: string
  qty: number
  price: number
  total: number
  unit: string
}

export interface PricingCategory {
  total: number
  services: PricingService[]
}

export type CategoryValue = PricingCategory | number

export interface PricingCompany {
  group: string
  categories: Record<string, CategoryValue>
  monthly: number
  annual: number
  monthly_total?: number
}

export type PricingData = Record<string, PricingCompany>

export interface PricingAdjustments {
  global: number
  groups: Record<string, number>
  categories: Record<string, number>
  companies: Record<string, number>
  group_dates: Record<string, string>
  category_dates: Record<string, string>
  company_dates: Record<string, string>
}

export function catTotal(val: CategoryValue): number {
  if (typeof val === 'object' && val !== null && 'total' in val) {
    return Number(val.total) || 0
  }
  return Number(val) || 0
}

export function aggregateBoardCats(categories: Record<string, CategoryValue>): Record<string, number> {
  const result: Record<string, number> = {}
  for (const bc of BOARD_CATS) result[bc] = 0
  for (const [boardCat, internalList] of Object.entries(CATEGORY_MAP)) {
    for (const internal of internalList) {
      if (internal in categories) result[boardCat] += catTotal(categories[internal])
    }
  }
  return result
}

export function applyAdjustments(data: PricingData, adj: PricingAdjustments | null): PricingData {
  if (!adj) return data

  // If all adjustments are zero, return original data to avoid float rounding errors
  const allZero = (adj.global || 0) === 0
    && Object.values(adj.groups || {}).every(v => v === 0)
    && Object.values(adj.categories || {}).every(v => v === 0)
    && Object.values(adj.companies || {}).every(v => v === 0)
  if (allZero) return data

  const g = (adj.global || 0) / 100
  const groups: Record<string, number> = {}
  for (const [k, v] of Object.entries(adj.groups || {})) groups[k] = v / 100
  const cats: Record<string, number> = {}
  for (const [k, v] of Object.entries(adj.categories || {})) cats[k] = v / 100
  const comps: Record<string, number> = {}
  for (const [k, v] of Object.entries(adj.companies || {})) comps[k] = v / 100

  const result: PricingData = {}
  for (const [name, info] of Object.entries(data)) {
    const newCats: Record<string, CategoryValue> = {}
    const multiplierBase = (1 + g) * (1 + (groups[info.group] || 0)) * (1 + (comps[name] || 0))

    for (const [cat, val] of Object.entries(info.categories)) {
      const base = catTotal(val)
      const mult = multiplierBase * (1 + (cats[cat] || 0))
      const adjusted = base * mult

      if (typeof val === 'object' && val !== null && 'services' in val) {
        const adjServices: PricingService[] = (val.services || []).map((svc) => ({
          ...svc,
          total: Math.round(((svc.total || 0) * mult) * 100) / 100,
          price: Math.round(((svc.price || 0) * mult) * 100) / 100,
        }))
        newCats[cat] = { total: Math.round(adjusted * 100) / 100, services: adjServices }
      } else {
        newCats[cat] = Math.round(adjusted * 100) / 100
      }
    }

    const monthly = Object.values(newCats).reduce<number>((sum, v) => sum + catTotal(v), 0)
    result[name] = {
      group: info.group,
      categories: newCats,
      monthly: Math.round(monthly * 100) / 100,
      annual: Math.round(monthly * 12 * 100) / 100,
    }
  }
  return result
}

export function parseEffectiveMonth(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null
  try {
    const parts = dateStr.split('-')
    return parseInt(parts[1], 10) - 1
  } catch {
    return null
  }
}

export function getCompanyEffMonth(
  companyName: string, groupName: string, adjustments: PricingAdjustments | null,
  globalEffDate: string | null, categoryName?: string,
): number {
  if (adjustments) {
    const cd = (adjustments.company_dates || {})[companyName]
    if (cd) { const m = parseEffectiveMonth(cd); if (m !== null) return m }
    if (categoryName) {
      const catD = (adjustments.category_dates || {})[categoryName]
      if (catD) { const m = parseEffectiveMonth(catD); if (m !== null) return m }
    }
    const gd = (adjustments.group_dates || {})[groupName]
    if (gd) { const m = parseEffectiveMonth(gd); if (m !== null) return m }
  }
  const m = parseEffectiveMonth(globalEffDate)
  if (m !== null) return m
  return 0
}

export function emptyAdjustments(): PricingAdjustments {
  return { global: 0, groups: {}, categories: {}, companies: {}, group_dates: {}, category_dates: {}, company_dates: {} }
}

export function validateNumeric(val: unknown, field: string): number {
  if (typeof val === 'number') return val
  if (typeof val === 'string') { const n = parseFloat(val); if (!isNaN(n)) return n }
  return 0
}
