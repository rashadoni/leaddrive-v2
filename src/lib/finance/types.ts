// Finance module types

export interface FinanceKPI {
  label: string
  plan: number
  fact: number
  variance: number
  variancePct: number
}

export interface AgingBucket {
  label: string
  amount: number
  count: number
}

export interface FinanceAlert {
  id: string
  type: "overdue_invoice" | "low_cash" | "budget_overspend" | "upcoming_payment"
  severity: "warning" | "critical" | "info"
  /** English fallback string; UI prefers `messageKey` + `params` via next-intl. */
  message: string
  /** i18n key under `finance.dash` for the localized alert text. */
  messageKey?: string
  /** Interpolation values (counts + pre-formatted currency strings) for `messageKey`. */
  params?: Record<string, string | number>
  link?: string
  amount?: number
}

export interface MonthlyTrend {
  month: number
  year: number
  label: string
  revenue: number
  expenses: number
  net: number
}

export interface ExpenseBreakdown {
  category: string
  /** When true, `category` is the generic "Other" overflow bucket — the UI renders a localized label instead of the raw string. */
  isOther?: boolean
  amount: number
  pct: number
  color: string
}

export interface FinanceDashboardData {
  kpis: {
    revenue: FinanceKPI
    expenses: FinanceKPI
    netProfit: { fact: number; prevMonth: number; changePct: number }
    cashBalance: { current: number; projected: number }
    arTotal: { amount: number; overdueAmount: number; overdueCount: number }
    apTotal: { amount: number; overdueAmount: number; overdueCount: number }
  }
  revenueTrend: MonthlyTrend[]
  expenseBreakdown: ExpenseBreakdown[]
  arAging: AgingBucket[]
  alerts: FinanceAlert[]
  year: number
  dateFrom?: string | null
  dateTo?: string | null
}

// Bill (A/P) types
export interface Bill {
  id: string
  billNumber: string
  vendorName: string
  vendorId?: string | null
  title: string
  status: string
  totalAmount: number
  paidAmount: number
  balanceDue: number
  currency: string
  issueDate: string
  dueDate?: string | null
  paidAt?: string | null
  category?: string | null
  notes?: string | null
  createdAt: string
  payments?: BillPayment[]
}

export interface BillPayment {
  id: string
  billId: string
  amount: number
  currency: string
  paymentMethod: string
  paymentDate: string
  reference?: string | null
  notes?: string | null
}

export interface CreateBillInput {
  billNumber: string
  vendorName: string
  vendorId?: string
  title: string
  totalAmount: number
  currency?: string
  issueDate?: string
  dueDate?: string
  category?: string
  notes?: string
}

export interface UpdateBillInput extends Partial<CreateBillInput> {
  status?: string
}

// Fund types
export interface Fund {
  id: string
  name: string
  description?: string | null
  targetAmount?: number | null
  targetAmountExact?: string | null
  currentBalance: number
  currentBalanceExact?: string
  currency: string
  color?: string | null
  isActive: boolean
  createdAt: string
  transactions?: FundTransaction[]
  rules?: FundRule[]
}

export interface FundTransaction {
  id: string
  fundId: string
  type: string
  amount: number
  amountExact?: string
  description?: string | null
  relatedType?: string | null
  relatedId?: string | null
  createdAt: string
}

export interface FundTransactionMutationResult extends FundTransaction {
  balance: number
  balanceExact: string
  eventId: string
  aggregateVersion: number
  warning?: string
}

export interface FundRule {
  id: string
  fundId: string
  name: string
  triggerType: string
  percentage?: number | null
  fixedAmount?: number | null
  isActive: boolean
}

export interface CreateFundInput {
  name: string
  description?: string
  targetAmount?: string | number
  currency?: string
  color?: string
  /** Stable across transport retries; regenerate only after success or edits. */
  idempotencyKey: string
}

export interface CreateFundTransactionInput {
  fundId: string
  type: string
  amount: string | number
  description?: string
  /** Stable across transport retries; regenerate only after success or edits. */
  idempotencyKey: string
}

export interface CreateFundRuleInput {
  fundId: string
  name: string
  triggerType: string
  percentage?: number
  fixedAmount?: number
}

// Receivables types
export interface ReceivablesData {
  total: number
  overdueTotal: number
  overdueCount: number
  aging: AgingBucket[]
  topDebtors: { companyName: string; companyId: string; amount: number; overdueAmount: number; invoiceCount: number }[]
  overdueInvoices: { id: string; invoiceNumber: string; companyName: string; totalAmount: number; balanceDue: number; dueDate: string; daysOverdue: number }[]
}

// Payables stats
export interface PayablesStats {
  total: number
  overdueTotal: number
  overdueCount: number
  aging: AgingBucket[]
  topVendors: { vendorName: string; vendorId?: string; amount: number; billCount: number }[]
  upcomingPayments: Bill[]
}

// Payment Registry types
export type PaymentDirection = "incoming" | "outgoing"
export type PaymentSourceType = "bill_payment" | "invoice_payment" | "fund_transaction" | "payment_order"

export interface PaymentRegistryEntry {
  id: string
  direction: PaymentDirection
  amount: number
  currency: string
  counterpartyName: string
  counterpartyId?: string | null
  sourceType: PaymentSourceType
  sourceId: string
  billId?: string | null
  invoiceId?: string | null
  fundId?: string | null
  category?: string | null
  paymentDate: string
  description?: string | null
  createdBy?: string | null
  createdAt: string
}

export interface PaymentRegistryFilters {
  direction?: PaymentDirection
  dateFrom?: string
  dateTo?: string
  category?: string
  counterparty?: string
  sourceType?: PaymentSourceType
}

export interface PaymentRegistryStats {
  totalIncoming: number
  totalOutgoing: number
  netFlow: number
  pendingOrdersCount: number
}

// Payment Order types
export type PaymentOrderStatus = "draft" | "pending_approval" | "approved" | "executed" | "rejected" | "cancelled"

export interface PaymentOrder {
  id: string
  orderNumber: string
  counterpartyName: string
  counterpartyId?: string | null
  billId?: string | null
  bankAccountId?: string | null
  amount: number
  currency: string
  purpose: string
  paymentMethod: string
  bankDetails?: string | null
  status: PaymentOrderStatus
  createdBy?: string | null
  approvedBy?: string | null
  approvedAt?: string | null
  executedAt?: string | null
  rejectedAt?: string | null
  rejectionReason?: string | null
  createdAt: string
  updatedAt: string
}

export interface CreatePaymentOrderInput {
  counterpartyName: string
  amount: number
  purpose: string
  counterpartyId?: string
  billId?: string
  bankAccountId?: string
  currency?: string
  paymentMethod?: string
  bankDetails?: string
}

export interface UpdatePaymentOrderInput extends Partial<CreatePaymentOrderInput> {}

// Bank Account types
export interface BankAccount {
  id: string
  accountName: string
  accountNumber?: string | null
  bankName: string
  bankCode?: string | null
  swiftCode?: string | null
  currency: string
  isDefault: boolean
  isActive: boolean
  createdAt: string
}

export interface CreateBankAccountInput {
  accountName: string
  bankName: string
  accountNumber?: string
  bankCode?: string
  swiftCode?: string
  currency?: string
  isDefault?: boolean
}

export interface PaymentOrdersStats {
  totalDraft: number
  totalPending: number
  totalApproved: number
  totalExecuted: number
  totalAmount: number
  executedAmount: number
}
