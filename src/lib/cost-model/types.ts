// Cost Model Types — shared across API routes, compute engine, and frontend
// ═══════════════════════════════════════════════════════════════════════════
// All string constants are centralized here. If you add a new service,
// department, or overhead category — update the constants below.
// ═══════════════════════════════════════════════════════════════════════════

// ── Tax & Rate Constants ──────────────────────────────────────────────────
export const INCOME_TAX_RATE = 0.14

// ── Service Types ─────────────────────────────────────────────────────────
export const SERVICE_TYPES = ["permanent_it", "infosec", "erp", "grc", "projects", "helpdesk", "cloud", "waf"] as const
export type ServiceType = (typeof SERVICE_TYPES)[number]

export const SERVICE_LABELS: Record<ServiceType, string> = {
  permanent_it: "Daimi IT",
  infosec: "InfoSec",
  erp: "ERP",
  grc: "GRC",
  projects: "Layihələr (PM)",
  helpdesk: "HelpDesk",
  cloud: "Bulud",
  waf: "WAF",
}

// ── Departments ───────────────────────────────────────────────────────────
export const DEPARTMENTS = ["IT", "InfoSec", "ERP", "GRC", "PM", "HelpDesk", "BackOffice"] as const
export type Department = (typeof DEPARTMENTS)[number]

export const DEPARTMENT_LABELS: Record<Department, string> = {
  IT: "IT",
  InfoSec: "InfoSec",
  ERP: "ERP",
  GRC: "GRC",
  PM: "PM",
  HelpDesk: "HelpDesk",
  BackOffice: "BackOffice",
}

// ── Service → Department mapping ──────────────────────────────────────────
export const SERVICE_DEPT_MAP: Record<ServiceType, Department[]> = {
  permanent_it: ["IT"],
  infosec: ["InfoSec"],
  erp: ["ERP"],
  grc: ["GRC"],
  projects: ["PM"],
  helpdesk: ["HelpDesk"],
  cloud: [], // IaaS from Pasha Technology (Cloud + SaaS), funded via overhead only
  waf: [],   // IaaS from Pasha Technology, resold as managed WAF
}

// ── Overhead category → service fallback (for tech infra routing) ─────────
export const TECH_DEPT_FALLBACK: Record<string, ServiceType> = {
  cloud_servers: "cloud",
  cloud: "cloud",
  waf_service: "waf",
  waf: "waf",
  ms_license: "permanent_it",
  service_desk: "permanent_it",
  cortex: "infosec",
  firewall_amort: "infosec",
  fw_amort: "infosec",
  palo_alto: "infosec",
  fw_license: "infosec",
  pam: "infosec",
}

// ── Per-employee overhead categories (multiplied by headcount) ─────────────
export const PER_EMPLOYEE_CATEGORIES = ["insurance", "mobile"] as const

// ── Known overhead categories ─────────────────────────────────────────────
export const OVERHEAD_CATEGORIES = [
  "cloud_servers", "waf_service",
  "office_rent", "insurance", "mobile", "cortex",
  "ms_license", "service_desk", "palo_alto", "pam", "lms",
  "trainings", "ai_licenses", "car_amort", "car_expenses",
  "firewall_amort", "laptops", "internet", "team_building",
] as const

// ── Validation helpers ────────────────────────────────────────────────────
export function isValidServiceType(s: string): s is ServiceType {
  return (SERVICE_TYPES as readonly string[]).includes(s)
}

export function isValidDepartment(d: string): d is Department {
  return (DEPARTMENTS as readonly string[]).includes(d)
}

export function isKnownOverheadCategory(c: string): boolean {
  return (OVERHEAD_CATEGORIES as readonly string[]).includes(c)
}

// ── Data Interfaces ───────────────────────────────────────────────────────

export interface CostModelParams {
  id?: string
  organizationId?: string
  totalUsers: number
  totalEmployees: number
  technicalStaff: number
  backOfficeStaff: number
  monthlyWorkHours: number
  vatRate: number
  employerTaxRate: number
  riskRate: number
  miscExpenseRate: number
  fixedOverheadRatio: number
}

export interface OverheadItem {
  id?: string | number
  organizationId?: string
  category: string
  label: string
  amount: number
  isAnnual: boolean
  hasVat: boolean
  isAdmin: boolean
  targetService?: string
  amortMonths?: number
  sortOrder: number
  notes?: string
}

export interface OverheadItemComputed extends OverheadItem {
  monthlyAmount: number
}

export interface EmployeeRow {
  id?: string | number
  organizationId?: string
  department: string
  position: string
  count: number
  netSalary: number
  grossSalary: number
  superGross: number
  inOverhead: boolean
  notes?: string
}

export interface EmployeeRowComputed extends EmployeeRow {
  totalLaborCost: number
}

export interface ClientCompany {
  id: string | number
  name: string
  costCode?: string
  userCount: number
}

export interface ClientServiceRow {
  id?: string | number
  companyId: string | number
  serviceType: string
  monthlyRevenue: number
  isActive: boolean
  notes?: string
}

export interface PricingRevenueRow {
  companyId: string
  monthlyTotal: number
}

export interface ServiceDetail {
  directLabor: number
  adminShare: number
  techDirect: number
  total: number
  headcount: number
  ratio: number
}

export interface ClientMargin {
  id: string | number
  name: string
  costCode: string
  userCount: number
  fixedCost: number
  variableCost: number
  totalCost: number
  totalRevenue: number
  margin: number
  marginPct: number
  status: "good" | "low" | "loss" | "no_revenue"
  services: Record<string, number>
  helpdeskRevenue?: number
}

export interface CostModelSummary {
  totalRevenue: number
  totalMargin: number
  marginPct: number
  profitableClients: number
  lossClients: number
  totalClients: number
}

export interface CostModelResult {
  grandTotalF: number
  grandTotalG: number
  adminOverhead: number
  techInfraTotal: number
  totalOverhead: number
  backOfficeCost: number
  grcDirectCost: number
  coreLabor: number
  sectionFSubtotal: number
  misc: number
  riskCost: number
  serviceCosts: Record<string, number>
  serviceDetails: Record<string, ServiceDetail>
  deptCosts: Record<string, number>
  overheadBreakdown: OverheadItemComputed[]
  employees: EmployeeRowComputed[]
  clients: ClientMargin[]
  totalUsers: number
  totalHeadcount: number
  summary: CostModelSummary
  params: CostModelParams
  costPerUserF: number
  costPerUserG: number
  serviceRevenues: Record<string, number>
  serviceClients: Record<string, number>
  warnings: string[]
}
